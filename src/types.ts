export type ID = string | number;

export interface Config {
    /** Максимальное количество создаваемых воркеров */
    maxWorkers: number;

    /** Оптимальное количество плееров в воркере */
    playersPerWorker: number;

    /**
     * Кэшировать отрисованные кадры. Это позволит значительно снизить нагрузку
     * на CPU, так как каждый кадр анимации отрисуется только один раз и при
     * циклическом воспроизведении будет брать кадр из кэша. Однако это
     * значительно потребление памяти. Каждый кадр будет занимать
     * `width × height × (dpr × 2) × 4` байт
     */
    cacheFrames: boolean;

    /**
     * Максимальное количество плееров, которые можно отрисовать за один кадр
     */
    maxRender?: number;

    /** Путь к воркеру или функция, которая вернёт путь к воркеру */
    workerUrl: string | (() => string | Promise<string>);

    /**
     * Коллбэк со статистикой рендеринга, используется для отладки
     */
    stats?: (stats: RenderStats) => void;
}

export interface PlayerOptions {
    /**
     * Lottie-анимация. Это может быть URL (начинается с протокола) либо сам
     * JSON-файл в виде строки или объекта
     */
    movie: string | object;

    /** Указатель на элемент <canvas>, где нужно рисовать анимацию */
    canvas: HTMLCanvasElement;

    /** Воспроизводить анимацию в цикле */
    loop?: boolean;

    /** Ширина кадра анимации. Если не указано, берётся из `.canvas` */
    width?: number;

    /** Высота кадра анимации. Если не указано, берётся из `.canvas` */
    height?: number;

    /** Плотность пикселей на экране. По умолчанию берётся devicePixelRatio */
    dpr?: number;

    /** Скорость воспроизведения ролика, кадров в секунду. По умолчанию 60 */
    fps?: number;

    /**
     * Если указан, все плееры, созданные с таким же ID, будут использовать один
     * и тот же экземпляр анимации и будут отрисовывать один и тот же кадр.
     * Это нужно для улучшения производительности, когда одну и ту же анимацию
     * нужно показать в нескольких местах. Рекомендуется всегда указывать этот
     * параметр, но если требуется, чтобы у одной и той же анимации были разные
     * таймланы (рисовали разные кадры), указывать не надо, но будет снижена
     * производительность.
     */
    id?: ID;
}

export interface WorkerPlayerOptions {
    /**
     * Уникальный идентификатор плеера. Используется для того, чтобы не создавать
     * отдельные инстансы для одной и той же анимации
     */
    id: ID;

    /** Данные с анимацией (JSON) */
    data: string;
}

/**
 * Запрос на отрисовку кадра
 */
export interface FrameRequest {
    id: ID;
    frame: number;
    width: number;
    height: number;
}

/**
 * Данные об отрисованном кадре
 */
 export interface FrameResponse {
    id: ID;
    width: number;
    height: number;
    frame: number;
    data: ArrayBuffer;
}

export interface CreateRequest {
    /**
     * Уникальный идентификатор плеера. Используется для того, чтобы не создавать
     * отдельные инстансы для одной и той же анимации
     */
    id: ID;

    /** Данные с анимацией (JSON) */
    data: string;
}

export interface CreateResponse {
    totalFrames: number;
    frameRate: number;
}

export interface CreateResponse {
    totalFrames: number;
}

export interface RenderRequest {
    frames: FrameRequest[]
}

export interface RenderResponse {
    frames: FrameResponse[];
}

export interface DisposeRequest {
    id: ID;
}

export interface DisposeResponse {
    ok: boolean;
}

export type RequestMap = {
    create: [CreateRequest, CreateResponse];
    render: [RenderRequest, RenderResponse];
    dispose: [DisposeRequest, DisposeResponse];
}

export interface WorkerRequest<K extends keyof RequestMap> {
    seq: number;
    name: K;
    payload: RequestMap[K][0];
}

export interface WorkerMessage {
    seq: number;
    name: keyof RequestMap;
    payload: any;
}

export interface RenderStats {
    /**
     * Время, затраченное на отрисовку кадра Lottie-анимации (может быть около
     * `0`, если используется кэширование кадров)
     */
    frameTime: number;

    /**
     * Время, затраченное на отрисовку кадра для все плееров в группе
     */
    paintTime: number;

    /**
     * Разница по времени между запросами за отрисовкой
     */
    tickDelta: number;
}

export type RenderStatsMap = Record<ID, RenderStats>;
