import lottieLoader, { type RlottieWasm } from './rlottie-wasm';
import type { ID, WorkerPlayerOptions, FrameResponse, FrameRequest, WorkerMessage, RequestMap } from './types';

/** Все инстансы плееров */
const instances = new Map<ID, WorkerPlayerInstace>();
let RLottie: typeof RlottieWasm;

class WorkerPlayerInstace {
    public id: string | number;
    public totalFrames = 0;
    public frameRate = 0;
    public disposed = false;
    private player: RlottieWasm | null = null;

    constructor(options: WorkerPlayerOptions) {
        this.id = options.id;
        this.player = new RLottie(options.data);
        this.totalFrames = this.player.frames();
        this.frameRate = this.player.frameRate();
    }

    /**
     * Отрисовка указанного кадра
     * @return Пиксельные данные о кадре или `undefined`, если отрисовать не удалось
     * (например, плеер ещё не загружен или указали неправильный кадр)
     */
    render(frame: number, width: number, height: number): ArrayBuffer | void {
        const { player, totalFrames } = this;
        if (player && frame >= 0 && frame < totalFrames) {
            const data = player.render(frame, width, height);

            // Из WASM кода возвращается указатель на буффер с кадром внутри WASM-кучи.
            // Более того, сам буффер переиспользуется для отрисовки последующих
            // кадров. Из-за этого мы
            // а) не можем передать его как transferable, так как он должен остаться
            //    внутри процесса
            // б) просто передать как аргумент и дать браузеру его скопировать,
            //    потому что копироваться будет вся WASM-куча
            // Так что делаем копию буффера вручную
            return copyBuffer(data);
        }
    }

    dispose() {
        // Для удаления инстанса в Emscripten
        this.player?.delete?.();
        this.player = null;
        this.disposed = true;
    }
}

function create(options: WorkerPlayerOptions) {
    const { id } = options;
    let instance = instances.get(id);
    if (!instance) {
        instance = new WorkerPlayerInstace(options);
        instances.set(id, instance);
    }

    return instance;
}

function dispose(id: ID) {
    const instance = instances.get(id);
    if (instance) {
        instances.delete(id);
        instance.dispose();
    }
}

/**
 * Отрисовка кадров для указанных анимаций
 */
function render(payload: FrameRequest[]) {
    const frames: FrameResponse[] = [];
    payload.forEach(req => {
        try {
            const instance = instances.get(req.id);
            const data = instance?.render(req.frame, req.width, req.height)
            if (data) {
                frames.push({ ...req, data });
            }
        } catch {}
    });

    return frames;
}

self.addEventListener('message', (evt: MessageEvent<WorkerMessage>) => {
    const { seq, name, payload } = evt.data

    switch (name) {
        case 'create':
            const instance = create(payload);
            respond(seq, name, {
                totalFrames: instance.totalFrames,
                frameRate: instance.frameRate
            });
            break;
        case 'dispose':
            dispose(payload.id);
            respond(seq, name, { ok: true });
            break;
        case 'render':
            const frames = render(payload.frames);
            respond(seq, name, { frames }, frames.map(f => f.data));
            break;
    }
});

/**
 * Быстрое копирование буффера
 */
function copyBuffer(src: Uint8Array): ArrayBuffer {
    const dst = new ArrayBuffer(src.byteLength);
    new Uint8Array(dst).set(src);
    return dst;
}

/**
 * Ответ на PRC-сообщение
 */
function respond<K extends keyof RequestMap>(seq: number, name: K, payload: RequestMap[K][1], transferable?: any) {
    self.postMessage({ seq, name, payload }, transferable);
}

lottieLoader.then(({ RlottieWasm }) => {
    RLottie = RlottieWasm;
    // Сообщаем, что загрузились
    self.postMessage({ type: 'init' });
});
