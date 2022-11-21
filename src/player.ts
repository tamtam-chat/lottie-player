import type { FrameData, ID, PlayerOptions, Request, Response, ResponseFrame, WorkerInfo, Config, EventPayload } from './types';
import RLottieWorker from './worker?worker&url';

export type { PlayerOptions, Config, ID, EventPayload };
type WorkerInstance = WorkerInfo<Player>;

let globalId = 0;

const workerPool: WorkerInstance[] = [];
const instances = new Map<ID, Player[]>();
const lastFrames = new Map<ID, FrameData>();
const config: Config = {
    maxWorkers: 4,
    playersPerWorker: 5,
    workerUrl: RLottieWorker
};

let workerUrlLoader: Promise<string> | undefined;

/**
 * Буфферный canvas, через который будем рисовать кадры другого размера
 */
const bufCanvas = document.createElement('canvas');

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
    workerPool.forEach(({ worker }) => worker?.postMessage({ type: 'global-playback', paused: false }));
}

/**
 * Остановка воспроизведения всех зарегистрированных плееров
 */
export function pause() {
    workerPool.forEach(({ worker }) => worker?.postMessage({ type: 'global-playback', paused: true }));
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
    public canvas: HTMLCanvasElement | undefined;
    public ctx: CanvasRenderingContext2D | undefined;
    public worker: WorkerInstance | undefined;
    public loop: boolean;
    public dpr: number;
    public paused = false;
    public frame = -1;
    public totalFrames = -1;

    constructor(options: PlayerOptions) {
        const { canvas } = options;
        const width = options.width || canvas.width;
        const height = options.height || canvas.height;

        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.id = options.id || `__lottie${globalId++}`;
        this.dpr = options.dpr || window.devicePixelRatio || 1;
        this.loop = options.loop || false;

        this.resize(width, height);

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
        this.dispatch(paused ? { type: 'pause' } : { type: 'play' });
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
     * Посылает в воркер уведомление, что изменился размер анимации
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

        this.worker = this.canvas = this.ctx = undefined;
        this.frame = this.totalFrames = -1;
        this.dispatch({ type: 'dispose' });
    }

    private send(message: Request) {
        const { worker } = this;
        if (worker) {
            sendMessage(worker, this, message);
        }
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
                    height: this.height,
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
function addInstance(player: Player): WorkerInstance {
    const { id } = player;
    let items = instances.get(id);
    let worker: WorkerInstance | undefined;
    if (items?.length) {
        worker = items[0].worker;
        items.push(player)
        // Сортируем список по размеру, от большего к меньшему.
        // Решаем две задачи: находим мастер-плеер (под размер которого рисует RLottie)
        // и группируем плееры по размеру. В этом случае из можно отрисовывать по
        // очереди и отдавать предыдущий плеер как референс: тем самым мы минимизируем
        // количество масштабирований при отрисовке плееров с разным размером
        items.sort((a, b) => b.width - a.width);
    } else {
        items = [player];
        instances.set(id, items);
    }

    const frame = lastFrames.get(id);
    if (frame) {
        const ix = items.indexOf(player);
        renderFrameForInstance(player, frame, items[ix - 1]?.canvas);
        dispatchEvent(player.canvas!, { type: 'initial-render' });
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

        // Обновим мастер-кадр, если надо
        const lastFrame = lastFrames.get(id);
        const firstPlayer = items[0];
        if (lastFrame && firstPlayer && !isSameSize(firstPlayer.canvas!, lastFrame.image)) {
            firstPlayer.sendSize(true);
        }

        return false;
    }

    // Если удаляем инстанс, для которого ещё не загрузился воркер,
    // удаляем все его сообщения из очереди
    workerPool.forEach(item => {
        item.queue = item.queue.filter(q => q.key !== player)
    });

    return true;
}

function renderFrameForInstance(instance: Player, data: FrameData, source?: HTMLCanvasElement) {
    const { canvas, ctx } = instance;
    if (canvas && ctx) {
        if (isSameSize(canvas, data.image)) {
            // putImage — самый быстрый вариант, будем использовать его, если размер подходит
            ctx.putImageData(data.image, 0, 0);
        } else {
            if (!source) {
                // Не указали отрисованный canvas, который можно отмасштабировать
                // до нужного размера: используем буфферный
                bufCanvas.width = data.image.width
                bufCanvas.height = data.image.height;
                const bufCtx = bufCanvas.getContext('2d')!;
                bufCtx.putImageData(data.image, 0, 0);
                source = bufCanvas;
            }

            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(source, 0, 0, width, height);
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
        const clampedBuffer = new Uint8ClampedArray(payload.data);
        const frameData: FrameData = {
            frame: payload.frame,
            totalFrames: payload.totalFrames,
            image: new ImageData(clampedBuffer, payload.width, payload.height)
        }
        lastFrames.set(id, frameData);
        items.forEach((player, i) => {
            renderFrameForInstance(player, frameData, items[i - 1]?.canvas);
        });
    }
}

function handleMessage(evt: MessageEvent<Response>) {
    const payload = evt.data;
    if (payload.type === 'frame') {
        renderFrame(payload);
    } else if (payload.type === 'init') {
        initWorker(evt.target as Worker);
    }
}

function isSameSize(canvas: HTMLCanvasElement, frame: ImageData): boolean {
    return frame.width === canvas.width && frame.height === canvas.height;
}

/**
 * Выделяет воркер для RLottie: либо создаёт новый, либо переиспользует существующий
 */
export function allocWorker(): WorkerInstance {
    let minPlayersWorker: WorkerInstance | undefined;
    for (let i = 0; i < workerPool.length; i++) {
        const info = workerPool[i];
        if (info.players < config.playersPerWorker) {
            info.players++;
            return info;
        }

        if (!minPlayersWorker || minPlayersWorker.players > info.players) {
            minPlayersWorker = info;
        }
    }

    // Если добрались сюда, значит, нет подходящего инстанса. Либо создадим новый,
    // либо будем превышать лимиты на существующих
    if (workerPool.length >= config.maxWorkers && minPlayersWorker) {
        minPlayersWorker.players++;
        return minPlayersWorker;
    }

    const w: WorkerInstance = {
        players: 1,
        loaded: false,
        queue: []
    };
    workerPool.push(w);
    attachWorker(w);
    return w;
}

/**
 * Освобождает указанный инстанс воркера
 */
export function releaseWorker(info: WorkerInstance) {
    info.players--;
    if (info.players <= 0) {
        const { worker } = info;
        if (worker) {
            info.worker = undefined;
            worker.removeEventListener('message', handleMessage);
            worker.terminate();
        }
        const itemIx = workerPool.indexOf(info);
        if (itemIx !== -1) {
            workerPool.splice(itemIx, 1);
        }
    }
}

function dispatchEvent(elem: Element, detail: EventPayload) {
    elem.dispatchEvent?.(new CustomEvent('lottie', { detail }));
}

/**
 * Отправляет сообщение в воркер. Если он ещё не был загружен, добавляет сообщения
 * в очередь на отправку
 */
function sendMessage(info: WorkerInstance, key: Player, message: Request) {
    if (info.loaded && info.worker) {
        info.worker.postMessage(message);
    } else {
        info.queue.push({ key, message });
    }
}

/**
 * Возвращает промис со ссылкой на воркер
 */
function getWorkerUrl(): Promise<string> {
    if (!workerUrlLoader) {
        const { workerUrl } = config;
        if (typeof workerUrl === 'string') {
            workerUrlLoader = Promise.resolve(workerUrl);
        } else {
            workerUrlLoader = workerUrl;
        }
    }

    return workerUrlLoader;
}

/**
 * Добавляет воркер к указанному инстансу
 */
function attachWorker(info: WorkerInstance) {
    getWorkerUrl().then(url => {
        if (workerPool.includes(info)) {
            info.worker = new Worker(url, { type: 'module' });
            info.worker.addEventListener('message', handleMessage);
        }
    });
}

/**
 * Инициализация созданного воркера: помечает инстанс, что воркер готов к работе
 */
function initWorker(worker: Worker) {
    const item = workerPool.find(item => item.worker === worker);
    if (item) {
        item.loaded = true;
        const queue = [...item.queue];
        item.queue.length = 0;
        queue.forEach(({ key, message}) => sendMessage(item, key, message));
    }
}
