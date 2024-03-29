import Player from './lib/Player';
import { getMovie } from './lib/utils';
import { allocWorker, releaseWorker, workerPool, type WorkerInstance } from './lib/worker-pool';
import { FrameRequest, FrameResponse, ID, PlayerOptions, RenderResponse, Config, RenderStats } from './types';
import { getConfig } from './lib/config';

export { updateConfig, getConfig } from './lib/config';
export type { Player };
export type { PlayerOptions, Config, ID };

interface PlayerRegistryItem {
    id: ID;

    /** Зарегистрированные плееры */
    players: Player[];

    /** Последний отрисованный кадр */
    frame: number;

    /** FPS текущей анимации */
    frameRate: number;

    /** Всего кадров в анимации */
    totalFrames: number;

    /** Время начала воспроизведения */
    start: number;

    /** Кэш отрисованных кадров */
    frameCache?: ImageData[];

    /** Инстанс воркера-отрисовщика, закреплённого за текущим элементом */
    worker?: WorkerInstance;
}

/** Реестр всех зарегистрированных плееров и привязанным к ним воркерам */
const registry = new Map<ID, PlayerRegistryItem>();

/** Глобальный флаг для остановки всех плееров */
let paused = false;
let rafId: number = 0;

/**
 * Время предыдущей отрисовки кадра. Используется для получения дельты для кадра,
 * который нужно нарисовать
 */
let prevTime = 0;

/**
 * Количество плееров, которые можно отрисовать. -1 означает, что рисуем всё,
 * 0 — нарисуем только один кадр, > 0 — можно обновить текущий плеер
 */
let maxPlayerRender = -1;

/**
 * Флаг, указывающий, доступна ли поддержка RLottie в текущей среде
 */
export const isSupported = wasmIsSupported() &&
    typeof Uint8ClampedArray !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof ImageData !== 'undefined';

/**
* Проверка поддержки работы WASM
*/
function wasmIsSupported() {
    try {
        if (typeof WebAssembly === 'object' &&
            typeof WebAssembly.instantiate === 'function') {
            const module = new WebAssembly.Module(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));

            if (module instanceof WebAssembly.Module) {
                return new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
            }
        }
    } catch (e) { }
    return false;
}

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
    paused = true;
    cancelAnimationFrame(rafId);
    rafId = prevTime = 0;
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
            player.mount(item);
            scheduleRender();
        }
    } else {
        const item: PlayerRegistryItem = {
            id,
            frame: 0,
            totalFrames: -1,
            frameRate: 60,
            start: 0,
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
                    if (resp.frameRate) {
                        item.frameRate = resp.frameRate;
                    }
                    item.players.forEach(player => player.mount(resp));
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
function render(time: number) {
    let rendered = false;
    maxPlayerRender = getConfig().maxRender || -1;
    const tickDelta = prevTime ? time - prevTime : 0;
    const stats: RenderStats = {
        frameTime: 0,
        paintTime: 0,
        tickDelta
    };

    /** Запросы на отрисовку, распределённые между своими воркерами */
    const workerPayload = new Map<WorkerInstance, FrameRequest[]>();

    // Сформируем нагрузку для отрисовки
    registry.forEach(item => {
        const { worker, players } = item;
        const firstPlaying = worker && players.find(isPlaying);
        if (firstPlaying) {
            // Есть плееры, где надо отрисовать кадры
            rendered = true;
            if (!item.start) {
                // Записываем время начала воспроизведения минус
                // смещение, чтобы начать отрисовывать с указанного кадра
                item.start = time - ((item.frame % firstPlaying.lastFrame) * firstPlaying.frameTime);
            }

            const req = toFrameRequest(firstPlaying, time - item.start);
            const cachedFrame = getCachedFrame(req);
            if (cachedFrame) {
                stats.paintTime += renderGroup(req.id, req.frame, cachedFrame);
            } else if (shouldRenderFrame(req.id, req.frame)) {
                const queue = workerPayload.get(worker);
                if (queue) {
                    queue.push(req);
                } else {
                    workerPayload.set(worker, [req]);
                }
            }
            item.frame = req.frame;
        } else {
            // Нет активных плееров: сбрасываем время начала воспроизведения
            item.start = 0;
        }
    });

    prevTime = time;


    if (workerPayload.size) {
        // Есть данные, которые нужно нарисовать через воркеры
        const start = performance.now();
        const promises: Promise<RenderResponse>[] = [];
        workerPayload.forEach((frames, worker) => {
            const req = worker.send('render', { frames })
                // Возможна ситуация, когда воркер уже размонтировался
                // в процессе отрисовки кадра, то есть плееры уже не нужны,
                // но воркер ещё не успел ответить. В этом случае контроллер сфэйлит все
                // зависшие запросы в воркере, но мы не должны прерываться
                .catch(() => ({ frames: [] }));
            promises.push(req);
        });

        Promise.all(promises).then(resp => {
            stats.frameTime = performance.now() - start;
            resp.forEach(payload => {
                payload.frames.forEach(frame => {
                    stats.paintTime += renderFrameResponse(frame);
                });
            });
            reportStats(stats);
            restartLoop();
        })
        .catch(() => restartLoop());
    } else {
        // Данных для воркера нет либо отрисовали из кэша
        reportStats(stats);
        restartLoop(rendered);
    }
}

/**
 * Вернёт закэшированный кадр, если его можно отрисовать для указанного запроса
 */
function getCachedFrame(req: FrameRequest): ImageData | void {
    const item = registry.get(req.id);
    if (item?.frameCache) {
        const frame = item.frameCache[req.frame];
        if (frame && frame.width >= req.width && frame.height >= req.height) {
            return frame;
        }
    }
}

/**
 * Записывает отрисованный кадр в кэш
 */
function setCachedFrame(id: ID, frame: number, image: ImageData) {
    const item = registry.get(id);
    if (item && item.totalFrames !== -1) {
        if (!item.frameCache) {
            item.frameCache = new Array(item.totalFrames);
        }

        item.frameCache[frame] = image;
    }
}

function toFrameRequest(player: Player, elapsed: number): FrameRequest {
    // В аругументе elapsed указано, сколько времени прошло с начала воспроизведения
    // плеера — посчитаем из него кадр
    let frame = Math.floor(elapsed / player.frameTime);
    frame = player.loop ? frame % player.lastFrame : Math.min(frame, player.lastFrame);

    return {
        id: player.id,
        width: player.width,
        height: player.height,
        frame
    };
}

function restartLoop(rendered?: boolean) {
    rafId = 0;
    if (rendered !== false) {
        scheduleRender();
    } else {
        prevTime = 0;
    }
}

/**
 * Отрисовка кадра из ответа от воркера.
 * Вернёт время, затраченное на отрисовку
 */
function renderFrameResponse(payload: FrameResponse): number {
    const start = performance.now();
    const { id } = payload;
    if (registry.has(id)) {
        const clampedBuffer = new Uint8ClampedArray(payload.data);
        const image = new ImageData(clampedBuffer, payload.width, payload.height);

        if (getConfig().cacheFrames) {
            setCachedFrame(id, payload.frame, image);
        }

        renderGroup(id, payload.frame, image);
    }

    return performance.now() - start;
}

/**
 * Отрисовка кадра для указанной группы. Вернёт время, затраченное на отрисовку
 */
function renderGroup(id: ID, frame: number, image: ImageData): number {
    const start = performance.now();
    const item = registry.get(id);
    let prevRendered: HTMLCanvasElement | undefined;

    if (item) {
        const { players } = item;
        // const lastPlayer = players.length - 1;
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            if (isPlaying(player) && shouldRenderPlayer(player, frame)) {
                renderFrame(player, frame, image, prevRendered);
                prevRendered = player.canvas;

                // const { width, height } = player;
                // if (i !== lastPlayer && (image.width !== width || image.height !== height)) {
                //     image = player.ctx.getImageData(0, 0, width, height);
                // }
            }
        }
    }

    return performance.now() - start;
}

/**
 * Отрисовка кадра в указанном плеере
 */
function renderFrame(player: Player, frame: number, image: ImageData, prev?: HTMLCanvasElement) {
    const isInitial = player.frame === -1;
    const { ctx, canvas, fill } = player;
    const { width, height } = canvas;
    const shouldRender = maxPlayerRender === -1 || maxPlayerRender > 0 || isInitial;

    if (shouldRender) {
        if (image.width === width && image.height === height && !fill) {
            // putImage — самый быстрый вариант, будем использовать его, если размер подходит
            ctx.putImageData(image, 0, 0);
        } else {
            if (!prev) {
                // Нет предыдущего отрисованный canvas, который можно отмасштабировать
                // до нужного размера: используем буфферный
                bufCanvas.width = image.width
                bufCanvas.height = image.height;
                const bufCtx = bufCanvas.getContext('2d')!;
                bufCtx.putImageData(image, 0, 0);
                prev = bufCanvas;
            }

            if (fill) {
                ctx.save();
                ctx.fillStyle = fill;
                ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(prev, 0, 0, width, height);
                ctx.restore();
            } else {
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(prev, 0, 0, width, height);
            }
        }

        if (maxPlayerRender > 0) {
            maxPlayerRender--;
        }
    }

    player.frame = frame;
    if (isInitial) {
        player.emit('rendered');
    }

    if (isFinished(player)) {
        player.pause();
        player.emit('end');
    }
}

/**
 * Вернёт `true`, если в указанной группе необходимо отрисовать указанный кадр.
 * В частности проверяет, был этот кадр уже отрисован
 */
function shouldRenderFrame(id: ID, frame: number): boolean {
    const item = registry.get(id);
    if (item) {
        return item.players.some(p => shouldRenderPlayer(p, frame));
    }

    return false;
}

/**
 * Вернёт `true` если указанный кадр нужно нарисорвать в плеере
 */
function shouldRenderPlayer(player: Player, frame: number): boolean {
    return player.totalFrames !== -1 && player.frame !== frame;
}

function reportStats(data: RenderStats) {
    const { stats } = getConfig();
    if (stats) {
        stats(data);
    }
}

function isFinished(player: Player) {
    return !player.loop && player.frame === player.lastFrame;
}
