import type { ID, PlayerOptions } from '../types';

let globalId = 0;

export interface PlayerEventMap {
    mount: [totalFrames: number];
    play: [];
    pause: [];
    end: [];
    rendered: [];
    resize: [width: number, height: number, dpr: number];
    dispose: [];
}

type PlayerEventNames = keyof PlayerEventMap;
type Listener = (...args: any[]) => void;

export default class Player {
    public readonly id: ID;
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public loop: boolean;
    public dpr: number;
    public paused = false;
    public frame = -1;
    public totalFrames = -1;

    private listeners: { [K in PlayerEventNames]?: Listener[] } = {};

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
    }

    get width() {
        return this.canvas?.width || 0;
    }

    get height() {
        return this.canvas?.height || 0;
    }

    get mounted() {
        return this.totalFrames !== -1;
    }

    /**
     * Запускает воспроизведение анимации
     */
    play() {
        if (this.paused) {
            this.paused = false;
            this.emit('play');
        }
    }

    /**
     * Останавливает воспроизведение анимации
     */
    pause() {
        if (!this.paused) {
            this.paused = true;
            this.emit('pause');
        }
    }

    /**
     * Переключает воспроизведение анимации
     */
    toggle() {
        if (this.paused) {
            this.play();
        } else {
            this.pause()
        }
    }

    /**
     * Меняет размер холста с анимацией. Так же убедится, что размер отрисовываемого
     * кадра будет не меньше
     */
    resize(width: number, height: number, dpr = this.dpr) {
        const { canvas } = this;
        if (canvas) {
            this.dpr = dpr;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            if (this.mounted) {
                this.emit('resize', width, height, dpr);
            }
        }
    }

    /**
     * Вызывается в момент, когда для указанного плеера смонтировался воркер.
     */
    mount(totalFrames: number) {
        if (!this.mounted) {
            this.totalFrames = totalFrames;
            this.emit('mount', totalFrames);
        }
    }

    /**
     * Удаляет текущий экземпляр плеера
     */
    dispose() {
        this.frame = this.totalFrames = -1;
        this.emit('dispose');
        this.listeners = {};
    }

    /**
     * Подписка на событие
     */
    on<E extends PlayerEventNames>(event: E, callback: (...args: PlayerEventMap[E]) => void): this {
        const listeners = this.listeners[event];
        if (listeners) {
            listeners.push(callback as Listener)
        } else {
            this.listeners[event] = [callback as Listener];
        }
        return this;
    }

    /**
     * Отписка от события
     */
    off<E extends PlayerEventNames>(event: E, callback: (...args: PlayerEventMap[E]) => void): this {
        const listeners = this.listeners[event];
        if (listeners) {
            // NB: используем новый массив, так как отписка от событий во время
            // выброса события приведет к потере вызова коллбэков
            const nextListeners: Listener[] = [];
            for (let i = 0; i < listeners.length; i++) {
                if (listeners[i] !== callback) {
                    nextListeners.push(listeners[i]);
                }
            }
            this.listeners[event] = nextListeners;
        }

        return this;
    }

    emit<E extends PlayerEventNames>(event: E, ...args: PlayerEventMap[E]): this {
        const listeners = this.listeners[event];
        if (listeners) {
            for (let i = 0; i < listeners.length; i++) {
                listeners[i].apply(null, args);
            }
        }
        return this;
    }
}
