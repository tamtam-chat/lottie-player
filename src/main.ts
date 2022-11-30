import Player from './lib/Player';
import { getMovie, isSameSize } from './lib/utils';
import { allocWorker, releaseWorker, workerPool, type WorkerInstance } from './lib/worker-pool';
import { FrameData, FrameRequest, FrameResponse, ID, PlayerOptions, RenderResponse } from './types';

export { updateConfig, getConfig } from './lib/config';

interface PlayerRegistryItem {
    id: ID;
    players: Player[];
    totalFrames: number;
    worker?: WorkerInstance;
}

/** Реестр всех зарегистрированных плееров и привязанным к ним воркерам */
const registry = new Map<ID, PlayerRegistryItem>();

/** Глобальный флаг для остановки всех плееров */
let paused = false;
let rafId: number = 0;

/**
 * Буфферный canvas, через который будем рисовать кадры другого размера
 */
 const bufCanvas = document.createElement('canvas');

/**
 * Создаёт плеер для указанной анимации
 */
export function createPlayer(options: PlayerOptions): Player {
    const player = new Player(options);
    registerPlayer(player, options.movie);

    player
        .on('play', () => scheduleRender())
        .on('dispose', () => unregisterPlayer(player))
        .on('resize', () => orderInstances(player.id));
    return player;
}

/**
 * Универсальный механизм для удаления плеера: можно передать сам плеер или
 * `<canvas>`, в котором рисуется анимация. Если указать `id` анимации, то будут
 * удалены все плееры с этим идентификатором.
 */
export function disposePlayer(player: ID | HTMLCanvasElement | Player) {
    if (player instanceof Player) {
        player.dispose();
    } else if (player && typeof player === 'object' && 'nodeType' in player) {
        // Удаляем плеер для указанного канваса
        registry.forEach(item => {
            item.players.forEach(item => {
                if (item.canvas === player) {
                    item.dispose();
                }
            });
        });
    } else {
        const item = registry.get(player);
        item?.players.forEach(item => item.dispose());
    }
}

/**
 * Запуск воспроизведения всех зарегистрированных плееров
 */
export function play() {
    paused = false;
    scheduleRender();
}

/**
 * Остановка воспроизведения всех зарегистрированных плееров
 */
export function pause() {
    paused = false;
    cancelAnimationFrame(rafId);
}

/**
 * Возвращает внутренности плеера для отладки
 * @private
 */
export function getInternals() {
    return { registry, workerPool, paused, rafId };
}

/**
 * Регистрирует указанный плеер в реестре плееров
 */
function registerPlayer(player: Player, movie: PlayerOptions['movie']) {
    const { id } = player;
    const item = registry.get(id);
    if (item) {
        // Уже есть запись реестра для плеера: значит, воспроизводим группу
        item.players.push(player);
        orderInstances(id);
        if (item.worker) {
            player.mount(item.totalFrames);
            scheduleRender();
        }
    } else {
        const item: PlayerRegistryItem = {
            id,
            totalFrames: -1,
            players: [player]
        };
        registry.set(id, item);

        // Параллельно загружаем воркер и ролик.
        // Не используем async/await для поддержки старых браузеров и для
        // сокращения кода при транспиляции
        Promise.all([allocWorker(), getMovie(movie)]).then(([worker, data]) => {
            // Создаём плеер для ролика
            worker.send('create', { id, data }).then(resp => {
                // Убедимся, что запись всё ещё присутствует и актуальна
                if (registry.get(id) === item) {
                    item.worker = worker;
                    item.totalFrames = resp.totalFrames;
                    item.players.forEach(player => player.mount(resp.totalFrames));
                    scheduleRender();
                } else {
                    releaseWorker(worker);
                }
            });
        });
    }
}

/**
 * Удаляет указанный плеер из реестра плееров
 */
function unregisterPlayer(player: Player) {
    const { id } = player;
    const item = registry.get(id);
    if (item) {
        item.players = item.players.filter(p => p !== player);
        if (!item.players.length) {
            registry.delete(id);

            if (item.worker) {
                releaseWorker(item.worker);
            }
        }
    }
}

/**
 * Сортируем список по размеру, от большего к меньшему.
 * Решаем две задачи: находим мастер-плеер (под размер которого рисует RLottie)
 * и группируем плееры по размеру. В этом случае из можно отрисовывать по
 * очереди и отдавать предыдущий плеер как референс: тем самым мы минимизируем
 * количество масштабирований при отрисовке плееров с разным размером
 */
function orderInstances(id: ID) {
    const item = registry.get(id);
    if (item && item.players.length > 1) {
        item.players.sort((a, b) => b.width - a.width);
    }
}

/**
 * Вернёт `true`, если указанный плеер можно воспроизводить
 */
function isPlaying(player: Player): boolean {
    return player.paused
        ? false
        : player.loop || (player.frame < player.totalFrames - 1);
}

/**
 * Планирует цикл отрисовки на следующий кадр, если это необходимо
 */
function scheduleRender() {
    if (!rafId && !paused) {
        rafId = requestAnimationFrame(render);
    }
}

/**
 * Цикл отрисовки: рисует следующий кадр для всех зарегистрированных плееров
 */
function render() {
    let rendered = false;

    /** Запросы на отрисовку, распределённые между своими воркерами */
    const workerPayload = new Map<WorkerInstance, FrameRequest[]>();

    // Сформируем нагрузку для отрисовки
    registry.forEach(item => {
        const { worker, players } = item;
        const firstPlaying = worker && players.find(isPlaying);
        if (firstPlaying) {
            // Есть плееры, где надо отрисовать кадры
            rendered = true;
            const req = toFrameRequest(firstPlaying);
            // TODO кэширование кадров
            const queue = workerPayload.get(worker);
            if (queue) {
                queue.push(req);
            } else {
                workerPayload.set(worker, [req]);
            }
        }
    });

    if (workerPayload.size) {
        // Есть данные, которые нужно нарисовать через воркеры
        const promises: Promise<RenderResponse>[] = [];
        workerPayload.forEach((frames, worker) => {
            promises.push(worker.send('render', { frames }));
        });

        Promise.all(promises).then(resp => {
            resp.forEach(payload => {
                payload.frames.forEach(frame => renderFrameResponse(frame));
            });
            restartLoop();
        })
        .catch(() => restartLoop());
    } else {
        // Данных для воркера нет либо отрисовали из кэша
        restartLoop(rendered);
    }
}

function toFrameRequest(player: Player, forSize: Player = player): FrameRequest {
    return {
        id: player.id,
        width: forSize.width,
        height: forSize.height,
        frame: (player.frame + 1) % player.totalFrames
    };
}

function restartLoop(rendered?: boolean) {
    rafId = 0;
    if (rendered !== false) {
        scheduleRender();
    }
}

/**
 * Отрисовка кадра из ответа от воркера
 */
function renderFrameResponse(payload: FrameResponse) {
    const { id } = payload;
    const items = registry.get(id);
    if (items) {
        let prevRendered: HTMLCanvasElement | undefined;
        const clampedBuffer = new Uint8ClampedArray(payload.data);
        const frameData: FrameData = {
            frame: payload.frame,
            image: new ImageData(clampedBuffer, payload.width, payload.height)
        };

        // TODO сохранить последний кадр

        items.players.forEach(player => {
            if (isPlaying(player)) {
                renderFrame(player, frameData, prevRendered);
                prevRendered = player.canvas;
            }
        });
    }
}

/**
 * Отрисовка кадра в указанном плеере
 */
function renderFrame(player: Player, frameData: FrameData, prev?: HTMLCanvasElement) {
    const isInitial = player.frame === -1;
    const { ctx, canvas } = player;

    if (isSameSize(canvas, frameData.image)) {
        // putImage — самый быстрый вариант, будем использовать его, если размер подходит
        ctx.putImageData(frameData.image, 0, 0);
    } else {
        if (!prev) {
            // Нет предыдущего отрисованный canvas, который можно отмасштабировать
            // до нужного размера: используем буфферный
            bufCanvas.width = frameData.image.width
            bufCanvas.height = frameData.image.height;
            const bufCtx = bufCanvas.getContext('2d')!;
            bufCtx.putImageData(frameData.image, 0, 0);
            prev = bufCanvas;
        }

        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(prev, 0, 0, width, height);
    }

    player.frame = frameData.frame;
    if (isInitial) {
        player.emit('rendered');
    }

    if (player.frame === player.totalFrames - 1) {
        player.emit('ended');
    }
}
