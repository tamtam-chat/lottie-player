export interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (err?: Error) => void;
}

export function deferred<T>(): Deferred<T> {
    let resolve: (value: T) => void = () => { /* empty */ };
    let reject: (err?: Error) => void = () => { /* empty */ };
    const promise = new Promise<T>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });

    return { promise, resolve, reject };
}

/**
 * Возвращает содержимое Lottie-анимации для передачи в воркер
 */
export function getMovie(movie: string | object): Promise<string> {
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
    });
}

export function isSameSize(canvas: HTMLCanvasElement, frame: ImageData): boolean {
    return frame.width === canvas.width && frame.height === canvas.height;
}
