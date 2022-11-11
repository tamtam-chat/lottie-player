export type ID = string | number;

export interface Config {
    /** Максимальное количество создаваемых воркеров */
    maxWorkers: number;

    /** Оптимальное количество плееров в воркере */
    playersPerWorker: number;

    /** Путь к воркеру */
    workerUrl: string;
}

export interface WorkerInfo {
    worker: Worker;
    players: number;
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
    /** JSON-данные с Lottie-анимацией */
    movie: string;

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
}

export type Response = ResponseFrame;

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
