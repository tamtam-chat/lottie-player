import { Module } from './rlottie-wasm';
import type { ID, WorkerPlayerOptions, FrameResponse, FrameRequest, WorkerMessage, RequestMap } from './types';

/** Все инстансы плееров */
const instances = new Map<ID, WorkerPlayerInstace>();
 interface RlottiePlayerAPI {
    init(): number;
    loadFromData(handle: number, stringOnWasmHeap: number): number;
    frameCount(): number;
    buffer(handle: number): number;
    render(handle: number, frame: number): void;
    destroy(handle: number): void;
    resize(handle: number, width: number, height: number): void;
}

class WorkerPlayerInstace {
    public id: string | number;
    public totalFrames = 0;
    public frameRate = 60;
    public handle: number;
    public disposed = false;
    public width = 0;
    public height = 0;
    private stringOnWasmHeap: number;
    private player: RlottiePlayerAPI = {
        init: Module.cwrap('lottie_init', '', []),
        destroy: Module.cwrap('lottie_destroy', '', ['number']),
        resize: Module.cwrap('lottie_resize', '', ['number', 'number', 'number']),
        buffer: Module.cwrap('lottie_buffer', 'number', ['number']),
        frameCount: Module.cwrap('lottie_frame_count', 'number', ['number']),
        render: Module.cwrap('lottie_render', '', ['number', 'number']),
        loadFromData: Module.cwrap('lottie_load_from_data', 'number', ['number', 'number']),
    };

    public constructor(options: WorkerPlayerOptions) {
        try {
            // @FIXME: Memory bottleneck fix it via https://github.com/Samsung/rlottie/issues/540
            const fps = JSON.parse(options.data)?.fr;

            this.frameRate = Math.max(1, Math.min(60, fps || 60));
        } catch (e) {}

        this.id = options.id;
        this.handle = this.player.init();
        this.stringOnWasmHeap = Module.allocate(Module.intArrayFromString(options.data), 'i8', 0);
        this.totalFrames = this.player.loadFromData(this.handle, this.stringOnWasmHeap);
    }

    /**
     * Отрисовка указанного кадра
     * @return Пиксельные данные о кадре или `undefined`, если отрисовать не удалось
     * (например, плеер ещё не загружен или указали неправильный кадр)
     */
    public render(frame: number, width: number, height: number): ArrayBuffer | undefined {
        const { player: player, totalFrames } = this;
        if (player && frame >= 0 && frame < totalFrames) {
            // const data = player.render(frame, width, height);

            if (this.width !== width || this.height !== height) {
                this.player.resize(this.handle, width, height);
                this.width = width;
                this.height = height;
            }

            this.player.render(this.handle, frame);

            const bufferPointer = this.player.buffer(this.handle);
            const data = Module.HEAPU8.subarray(bufferPointer, bufferPointer + (this.width * this.height * 4));

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

        return;
    }

    public dispose() {
        // Для удаления инстанса в Emscripten
        this.player?.destroy?.(this.handle);
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
    payload.forEach((req: FrameRequest) => {
        try {
            const instance = instances.get(req.id);
            const data = instance?.render(req.frame, req.width, req.height);
            if (data) {
                frames.push({ ...req, data });
            }
        } catch {}
    });

    return frames;
}

self.addEventListener('message', (evt: MessageEvent<WorkerMessage>) => {
    const { seq, name, payload } = evt.data;

    switch (name) {
        case 'create':
            const instance = create(payload);
            respond(seq, name, {
                totalFrames: instance.totalFrames,
                frameRate: instance.frameRate,
            });
            break;
        case 'dispose':
            dispose(payload.id);
            respond(seq, name, { ok: true });
            break;
        case 'render':
            const frames = render(payload.frames);
            respond(seq, name, { frames }, frames.map((f: FrameResponse) => f.data));
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

Module.onRuntimeInitialized = function() {
    // Сообщаем, что загрузились
    self.postMessage({ type: 'init' });

    return void 0;
};
