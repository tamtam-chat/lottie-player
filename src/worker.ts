import lottieLoader, { RlottieWasm } from './rlottie-wasm';
import type { ID, WorkerPlayerOptions, ResponseFrame, Request, AdjustablePlayerOptions } from './types';

let rafId: number = 0;

/** Глобальный флаг для остановки всех плееров */
let paused = false;

/** Все инстансы плееров */
const instances = new Map<ID, WorkerPlayerInstace>();

class WorkerPlayerInstace {
    public id: string | number;
    public width: number;
    public height: number;
    public loop: boolean;
    public paused = false;
    public frame = 0;
    public totalFrames = 0;
    public disposed = false;

    private player: RlottieWasm | null = null;

    constructor(options: WorkerPlayerOptions) {
        this.id = options.id;
        this.width = options.width || 100;
        this.height = options.height || 100;
        this.loop = options.loop ?? true;
        if (typeof options.autoplay === 'boolean') {
            this.paused = !options.autoplay;
        }

        lottieLoader.then(({ RlottieWasm }) => {
            if (this.disposed) {
                return;
            }
            this.player = new RlottieWasm(options.data);
            this.totalFrames = this.player.frames();
        }).catch((err) => {
            console.error(err);
            this.disposed = true;
        });
    }

    render(): boolean {
        if (this.disposed || this.paused) {
            return false;
        }

        if (!this.player) {
            // Если нет плеера, нужно дождаться, пока появится, поэтому возвращаем
            // true, чтобы не прерывался цикл
            return true;
        }

        if (this.frame >= this.totalFrames) {
            if (!this.loop) {
                return false;
            }
            this.frame = 0;
        }

        const { id, width, height, frame, totalFrames } = this;
        const f = this.player.render(frame, width, height);

        // Из WASM кода возвращается указатель на буффер с кадром внутри WASM-кучи.
        // Более того, сам буффер переиспользуется для отрисовки последующих
        // кадров. Из-за этого мы
        // а) не можем передать его как transferable, так как он должен остаться
        //    внутри процесса
        // б) просто передать как аргумент и дать браузеру его скопировать,
        //    потому что копироваться будет вся WASM-куча
        // Так что делаем копию буффера вручную
        const data = copyBuffer(f)

        self.postMessage({
            type: 'frame',
            id,
            width,
            height,
            frame,
            totalFrames,
            data
        } as ResponseFrame, [data] as any);
        this.frame++;

        return true;
    }

    update(options: AdjustablePlayerOptions, IfRequired?: boolean) {
        // Обновим данные, если надо
        if (options.width && (!IfRequired || options.width > this.width)) {
            this.width = options.width;
        }

        if (options.height && (!IfRequired || options.height > this.height)) {
            this.height = options.height;
        }

        if (options.loop != null) {
            this.loop = options.loop;
        }
    }

    dispose() {
        // Для удаления инстанса в Emscripten
        this.player?.delete?.();
        this.player = null;
        this.disposed = true;
    }
}

function loop() {
    rafId = 0;

    if (paused) {
        return;
    }

    let rendered = false;

    instances.forEach((instance, key) => {
        if (instance.disposed) {
            instances.delete(key);
        } else if (instance.render()) {
            rendered = true;
        }
    });

    if (rendered && instances.size) {
        rafId = requestAnimationFrame(loop);
    }
}

function play() {
    paused = false;
    if (!rafId) {
        loop();
    }
}

function pause() {
    paused = true;
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
    }
}

function create(options: WorkerPlayerOptions) {
    let instance = instances.get(options.id);
    if (instance) {
        instance.update(options, true);
    } else {
        instance = new WorkerPlayerInstace(options);
        instances.set(instance.id, instance);
    }

    if (instances.size === 1 && !paused) {
        play();
    }
}

self.addEventListener('message', (evt: MessageEvent<Request>) => {
    const payload = evt.data;
    const instance = 'id' in payload
        ? instances.get(payload.id)
        : undefined;

    switch (payload.type) {
        case 'create':
            create(payload.data);
            break;
        case 'dispose':
            if (instance) {
                instance.dispose();
                instances.delete(payload.id);
            }
            break;
        case 'playback':
            if (instance) {
                instance.paused = payload.paused;
                if (!instance.paused) {
                    play();
                }
            }
            break;
        case 'restart':
            if (instance) {
                instance.frame = 0;
                instance.paused = false;
                play();
            }
            break;
        case 'update':
            if (instance) {
                instance.update(payload.data, payload.ifRequired);
                play();
            }
            break;
        case 'global-playback':
            paused = payload.paused;
            if (paused) {
                pause();
            } else {
                play();
            }
            break;
    }
});

function copyBuffer(src: Uint8Array): ArrayBuffer {
    const dst = new ArrayBuffer(src.byteLength);
    new Uint8Array(dst).set(src);
    return dst;
}

// Сообщаем, что загрузились
self.postMessage({
    type: 'init'
});
