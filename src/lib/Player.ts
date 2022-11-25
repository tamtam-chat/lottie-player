import { EventPayload, ID, PlayerOptions, Request, WorkerInfo } from '../types';

let globalId = 0;
const instances = new Map<ID, Player[]>();

export interface PlayerEventMap {
    mount: [];
    play: [];
    pause: [];
    resize: [width: number, height: number, dpr: number];
}

type PlayerEventNames = keyof PlayerEventMap;

export class Player {
    public readonly id: ID;
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public worker: WorkerInfo;
    public loop: boolean;
    public dpr: number;
    public paused = false;
    public frame = -1;
    public totalFrames = -1;

    private listeners: { [K in PlayerEventNames]?: ((...args: any[]) => void)[] };

    constructor(options: PlayerOptions) {
        this.listeners = {};
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
        this.dispatch(paused ? { type: 'pause' } : { type: 'play' });
    }

    restart() {
        const items = instances.get(this.id);
        if (items) {
            items.forEach(item => {
                item.paused = false,
                item.frame = 0;
            });
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

            orderInstances(this.id);
            // renderLastFrame(this);
        }
    }

    /**
     * Удаляет текущий экземпляр плеера
     */
    dispose() {
        this.frame = this.totalFrames = -1;
        this.dispatch({ type: 'dispose' });
    }

    /**
     * Вызывается после того, как воркер-плеер проинициализировался и готов
     * к отрисовке анимации
     * @private
     */
    onMount(totalFrames: number) {
        if (this.totalFrames === -1) {
            this.totalFrames = totalFrames;
            dispatchEvent(this.canvas!, { type: 'mount' });
        }
    }

    /**
     * Подписка на событие
     */
    on<E extends PlayerEventNames>(...args: PlayerEventMap[E]): this {

        return this;
    }

    private dispatch(detail: EventPayload) {
        if (this.canvas) {
            dispatchEvent(this.canvas, detail);
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
    const items = instances.get(id);
    if (items && items.length > 1) {
        items.sort((a, b) => b.width - a.width);
    }
}

function dispatchEvent(elem: Element, detail: EventPayload) {
    elem.dispatchEvent?.(new CustomEvent('lottie', { detail }));
}
