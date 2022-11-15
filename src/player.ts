import type { FrameData, ID, PlayerOptions, Request, Response, ResponseFrame, WorkerInfo, Config, EventPayload } from './types';
import RLottieWorker from './worker?worker&url';

export type { PlayerOptions, Config, ID, EventPayload };

let globalId = 0;

const workerPool: WorkerInfo[] = [];
const instances = new Map<ID, Player[]>();
const lastFrames = new Map<ID, FrameData>();
const config: Config = {
    maxWorkers: 4,
    playersPerWorker: 5,
    workerUrl: RLottieWorker
};

/**
 * Создаёт плеер для указанной анимации
 */
export function createPlayer(options: PlayerOptions): Player {
    return new Player(options);
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
        instances.forEach(items => {
            items.forEach(item => {
                if (item.canvas === player) {
                    item.dispose();
                }
            });
        });
    } else {
        const items = instances.get(player);
        items?.forEach(item => item.dispose());
    }
}

/**
 * Обновление параметров контроллера плеера
 */
export function updateConfig(data: Partial<Config>): void {
    Object.assign(config, data);
}

/**
 * Запуск воспроизведения всех зарегистрированных плееров
 */
export function play() {
    workerPool.forEach(({ worker }) => worker.postMessage({ type: 'global-playback', paused: false }));
}

/**
 * Остановка воспроизведения всех зарегистрированных плееров
 */
export function pause() {
    workerPool.forEach(({ worker }) => worker.postMessage({ type: 'global-playback', paused: true }));
}

/**
 * Возвращает внутренние данные модуля.
 * *Использовать только для отладки и тестирования!*
 */
export function getInternals() {
    return { workerPool, instances, lastFrames, config };
}

export class Player {
    public readonly id: ID;
    public canvas: HTMLCanvasElement | null = null;
    public worker: Worker | null = null;
    public loop: boolean;
    public dpr: number;
    public paused = false;
    public frame = -1;
    public totalFrames = -1;

    constructor(options: PlayerOptions) {
        const { canvas } = options;
        this.canvas = canvas;
        this.id = options.id ?? `__lottie${globalId++}`;
        this.dpr = options.dpr || window.devicePixelRatio || 1;
        this.loop = options.loop ?? false;

        this.resize(canvas.width, canvas.height);

        this.worker = addInstance(this);
        this.setupMovie(options.movie);
    }

    get width() {
        return this.canvas?.width || 0;
    }

    get height() {
        return this.canvas?.height || 0;
    }

    play() {
        this.toggle(false);
    }

    pause() {
        this.toggle(true);
    }

    toggle(paused = !this.paused) {
        const items = instances.get(this.id);
        if (items) {
            items.forEach(item => item.paused = paused);
        }

        this.send({
            type: 'playback',
            id: this.id,
            paused
        });
        this.dispatch( paused ? { type: 'pause' } : { type: 'play' });
    }

    restart() {
        const items = instances.get(this.id);
        if (items) {
            items.forEach(item => item.paused = false);
        }

        this.send({
            type: 'restart',
            id: this.id,
        });
    }

    /**
     * Меняет размер холста с анимацией. Так же убедится, что размер отрисовываемого
     * кадра будет не меньше
     */
    resize(width: number, height: number) {
        const { canvas, dpr } = this;
        if (canvas) {
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        this.sendSize();
    }

    /**
     * @private
     * Посылает в воркер уведомление, что изменился размер анимаци
     * @param master Делает плеер мастером: его размер будет использоваться для
     * отрисовки, а все остальные плееры с таким же ID будут брать изображение
     * мастер-плеера
     */
    sendSize(master?: boolean) {
        this.send({
            type: 'update',
            id: this.id,
            data: {
                width: this.width,
                height: this.height
            },
            ifRequired: !master
        });
    }

    /**
     * Удаляет текущий экземпляр плеера
     */
    dispose() {
        if (removeInstance(this)) {
            this.send({
                type: 'dispose',
                id: this.id
            });
        }

        this.worker = this.canvas = null;
        this.frame = this.totalFrames = -1;
        this.dispatch({ type: 'dispose' });
    }

    private send(message: Request) {
        this.worker?.postMessage(message);
    }

    private setupMovie(movie: PlayerOptions['movie']) {
        // NB: не используем async/await для поддержки старых браузеров
        return Promise.resolve().then(() => {
            if (typeof movie === 'string') {
                if (/^(https?|data|file):/.test(movie)) {
                    return fetch(movie, { mode: 'cors' }).then(res => {
                        if (res.ok) {
                            return res.text();
                        }

                        throw new Error(`Invalid response: ${res.status}: ${res.statusText}`);
                    });
                }

                return movie;
            }

            return JSON.stringify(movie);
        })
        .then(data => {
            this.send({
                type: 'create',
                data: {
                    id: this.id,
                    data,
                    width: this.width,
                    height:this.height,
                    loop: this.loop
                }
            });
            this.dispatch({ type: 'mount' });
        })
        .catch(error => {
            this.dispatch({ type: 'error', error });
            throw error;
        });
    }

    private dispatch(detail: EventPayload) {
        if (this.canvas) {
            dispatchEvent(this.canvas, detail);
        }
    }
}

/**
 * Добавляет указанный экземпляр в общую таблицу плееров
 * @returns Вернёт воркер, через который надо общаться с бэком
 */
function addInstance(player: Player): Worker {
    const { id } = player;
    const items = instances.get(id);
    let worker: Worker | null = null;
    if (items?.length) {
        worker = items[0].worker;
        items.push(player);
    } else {
        instances.set(id, [player]);
    }

    const frame = lastFrames.get(id);
    if (frame) {
        renderFrameForInstance(player, frame);
    }

    return worker || allocWorker();
}

/**
 * Удаляет указанный экземпляр плеера из общей таблицы
 * @returns Вернёт `true` если это был последний экземпляр для ID плеера и можно
 * полностью удалить плеер
 */
function removeInstance(player: Player): boolean {
    const { id } = player;
    const items = instances.get(id);
    if (items) {
        const ix = items.indexOf(player);
        if (ix !== -1) {
            items.splice(ix, 1);
        }

        if (!items.length) {
            instances.delete(id);
            lastFrames.delete(id);
            releaseWorker(player.worker!);
            return true;
        }

        // Обновим мастер-плеер, если надо
        const lastFrame = lastFrames.get(id);
        if (lastFrame && isMasterPlayer(player, lastFrame)) {
            let nextMaster: Player | undefined;
            items.forEach(p => {
                if (!nextMaster || p.width > nextMaster.width || p.height > nextMaster.height) {
                    nextMaster = p;
                }
            });

            if (nextMaster && !isMasterPlayer(nextMaster, lastFrame)) {
                nextMaster.sendSize(true);
            }
        }


        return false;
    }

    return true;
}

function renderFrameForInstance(instance: Player, data: FrameData, image?: HTMLCanvasElement) {
    const { canvas } = instance;
    if (canvas) {
        const ctx = canvas.getContext('2d')!;
        if (image) {
            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
        } else {
            ctx.putImageData(data.image, 0, 0);
        }
        const isInitial = instance.frame === -1;
        instance.frame = data.frame;
        instance.totalFrames = data.totalFrames;
        if (isInitial) {
            dispatchEvent(canvas, { type: 'initial-render' });
        }
    }
}

function renderFrame(payload: ResponseFrame) {
    // Для отрисовки анимации на наборе плееров нужно сделать следующее:
    // * Найти мастер-плеер, у которого размер совпадает с размером кадра
    //   и отрисовать в нём кадр
    // * Для всех остальных плееров использовать мастер-плеер, чтобы нарисовать
    //   отмасштабированную картинку
    const { id } = payload;
    const items = instances.get(id);
    if (items) {
        let masterCanvas: HTMLCanvasElement | undefined;
        const clampedBuffer = new Uint8ClampedArray(payload.data);
        const frameData: FrameData = {
            frame: payload.frame,
            totalFrames: payload.totalFrames,
            image: new ImageData(clampedBuffer, payload.width, payload.height)
        }
        lastFrames.set(id, frameData);
        const master = items.find(p => isMasterPlayer(p, frameData));
        if (master?.canvas) {
            renderFrameForInstance(master, frameData);
            masterCanvas = master.canvas;
        }

        items.forEach(p => {
            if (p !== master) {
                renderFrameForInstance(p, frameData, masterCanvas);
            }
        });
    }
}

function isMasterPlayer(player: Player, frameData: FrameData): boolean {
    return player.width === frameData.image.width && player.height === frameData.image.height
}

function handleMessage(evt: MessageEvent<Response>) {
    const payload = evt.data;
    if (payload.type === 'frame') {
        renderFrame(payload);
    }
}

/**
 * Выделяет воркер для RLottie: либо создаёт новый, либо переиспользует существующий
 */
function allocWorker(): Worker {
    let minPlayersWorker: WorkerInfo | undefined;
    for (let i = 0; i < workerPool.length; i++) {
        const info = workerPool[i];
        if (info.players < config.playersPerWorker) {
            info.players++;
            return info.worker;
        }

        if (!minPlayersWorker || minPlayersWorker.players > info.players) {
            minPlayersWorker = info;
        }
    }

    // Если добрались сюда, значит, нет подходящего инстанса. Либо создадим новый,
    // либо будем превышать лимиты на существующих
    if (workerPool.length >= config.maxWorkers && minPlayersWorker) {
        minPlayersWorker.players++;
        return minPlayersWorker.worker;
    }
    const worker = new Worker(config.workerUrl, {
        type: 'module'
    });
    worker.addEventListener('message', handleMessage);
    workerPool.push({ worker, players: 1 });
    return worker;
}

/**
 * Освобождает указанный инстанс воркера
 */
function releaseWorker(worker: Worker) {
    const itemIx = workerPool.findIndex(item => item.worker === worker);
    if (itemIx !== -1) {
        const item = workerPool[itemIx]!;
        item.players--;
        if (item.players <= 0) {
            worker.removeEventListener('message', handleMessage);
            worker.terminate();
            workerPool.splice(itemIx, 1);
        }
    }
}

function dispatchEvent(elem: Element, detail: EventPayload) {
    elem.dispatchEvent?.(new CustomEvent('lottie', { detail }));
}
