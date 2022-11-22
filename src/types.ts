export type ID = string | number;

export interface Config {
    /** Максимальное количество создаваемых воркеров */
    maxWorkers: number;

    /** Оптимальное количество плееров в воркере */
    playersPerWorker: number;

    /** Путь к воркеру или функция, который вернёт путь к воркеру */
    workerUrl: string | (() => string | Promise<string>);
}

export interface WorkerInfo<T = unknown> {
    worker?: Worker;
    players: number;
    loaded: boolean;
    queue: WorkerQueueItem<T>[];
}

export interface WorkerQueueItem<T = unknown> {
    key: T;
    message: Request;
}

export interface FrameData {
    frame: number;
    totalFrames: number;
    image: ImageData;
}

export interface AdjustablePlayerOptions {
    /** Ширина кадра для отрисовки */
    width?: number;

    /** Высота кадра для отрисовки */
    height?: number;

    /** Воспроизводить в цикле */
    loop?: boolean;
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

export interface WorkerPlayerOptions extends AdjustablePlayerOptions {
    /**
     * Уникальный идентификатор плеера. Используется для того, чтобы не создавать
     * отдельные инстансы для одной и той же анимации
     */
    id: ID;

    /** Данные с анимацией (JSON) */
    data: string;

    /** Сразу воспроизводить анимацию. По умолчанию `true` */
    autoplay?: boolean;
}

export type Response = ResponseFrame | ResponseInit;

/**
 * Данные об отрисованном кадре анимации
 */
export interface ResponseFrame {
    type: 'frame';
    id: ID;
    width: number;
    height: number;
    frame: number;
    totalFrames: number;
    data: ArrayBuffer;
}

/**
 * Сообщение, что воркер загрузился и проинициализировался
 */
export interface ResponseInit {
    type: 'init';
}

export type Request = RequestCreate | RequestDispose | RequestTogglePlayback
    | RequestUpdate | RequestRestart | RequestGlobalTogglePlayback;

/**
 * Создание нового инстанса для отрисовки анимации
 */
export interface RequestCreate {
    type: 'create';
    data: WorkerPlayerOptions;
}

/**
 * Удаление инстанса плеера с указанным ID
 */
export interface RequestDispose {
    type: 'dispose';
    id: ID;
}

/**
 * Переключение статуса воспроизведения для указанной анимации
 */
export interface RequestTogglePlayback {
    type: 'playback';
    id: ID;
    paused: boolean;
}

/**
 * Обновление данных о плеере
 */
export interface RequestUpdate {
    type: 'update';
    id: ID;
    data: AdjustablePlayerOptions;
    ifRequired?: boolean;
}

/**
 * Перезапуск воспроизведения плеера, начинает играть с первого кадра
 */
export interface RequestRestart {
    type: 'restart';
    id: ID;
}

/**
 * Глобальное переключение воспроизведения для всех плееров
 */
 export interface RequestGlobalTogglePlayback {
    type: 'global-playback';
    paused: boolean;
}

export type EventPayload = EventPayloadMount | EventPayloadDispose | EventPayloadInitialRender
    | EventPayloadPlay | EventPayloadPause | EventPayloadError;

export interface EventPayloadMount {
    type: 'mount';
}

export interface EventPayloadDispose {
    type: 'dispose';
}

export interface EventPayloadInitialRender {
    type: 'initial-render';
}

export interface EventPayloadPlay {
    type: 'play';
}

export interface EventPayloadPause {
    type: 'pause';
}

export interface EventPayloadError {
    type: 'error';
    error: Error;
}
