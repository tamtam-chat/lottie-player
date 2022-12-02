import type { RequestMap, WorkerRequest, WorkerMessage } from '../types';
import { getConfig } from './config';
import { type Deferred, deferred } from './utils';

export const workerPool: WorkerInstance[] = [];
const maxSeq = 1_000_000;
let workerUrlLoader: Promise<string> | undefined;
let workerId = 1;

export class WorkerInstance {
    public refs = 0;
    public readonly id: number;
    private deferred = deferred<WorkerInstance>();
    private worker: Worker | undefined;
    private seq = 0;
    private requests = new Map<number, Deferred<any>>();

    constructor() {
        this.id = workerId++;
    }

    onMessage = (evt: MessageEvent<WorkerMessage>) => {
        if ('seq' in evt.data) {
            const { seq, payload } = evt.data;
            const resp = this.requests.get(seq);
            if (resp) {
                this.requests.delete(seq);
                resp.resolve(payload);
            }
        }
    }

    get promise(): Promise<WorkerInstance> {
        return this.deferred.promise;
    }

    /**
     * Шлёт запрос в указанный воркер
     */
    send<K extends keyof RequestMap>(name: K, payload: RequestMap[K][0]): Promise<RequestMap[K][1]> {
        this.seq = (this.seq + 1) % maxSeq;
        const seq = this.seq;
        const req: WorkerRequest<K> = { name, payload, seq };
        const resp = deferred<RequestMap[K][1]>();
        if (this.worker) {
            this.requests.set(seq, resp);
            this.worker.postMessage(req);
        } else {
            resp.reject(new Error('Worker is not mounted'));
        }

        return resp.promise;
    }

    attach(worker: Worker) {
        this.worker = worker;
        this.worker.addEventListener('message', this.onMessage);
        this.deferred.resolve(this);
    }

    fail(err?: Error) {
        this.deferred.reject(err);
    }

    dispose() {
        if (this.requests.size) {
            this.requests.forEach(req => req.reject(terminateErr()));
            this.requests.clear();
        }

        if (this.worker) {
            this.worker.removeEventListener('message', this.onMessage);
            this.worker.terminate();
            this.worker = undefined;
        } else {
            this.fail(terminateErr());
        }
    }
}

/**
 * Выделяет воркер для RLottie: либо создаёт новый, либо переиспользует существующий
 */
export function allocWorker(): Promise<WorkerInstance> {
    const config = getConfig();
    let worker: WorkerInstance | undefined;
    let minPlayersWorker: WorkerInstance | undefined;

    for (let i = 0; i < workerPool.length; i++) {
        const item = workerPool[i];
        if (item.refs < config.playersPerWorker) {
            worker = item;
            break;
        }

        if (!minPlayersWorker || minPlayersWorker.refs > item.refs) {
            minPlayersWorker = item;
        }
    }

    // Если добрались сюда, значит, нет подходящего инстанса. Либо создадим новый,
    // либо будем превышать лимиты на существующих
    if (!worker && minPlayersWorker && workerPool.length >= config.maxWorkers) {
        worker = minPlayersWorker;
    }

    if (!worker) {
        worker = new WorkerInstance();
        workerPool.push(worker);
        attachWorker(worker);
    }

    worker.refs++;
    return worker.promise;
}

/**
 * Освобождает указанный инстанс воркера
 */
 export function releaseWorker(instance: WorkerInstance) {
    instance.refs--;
    if (instance.refs <= 0) {
        instance.dispose();

        const itemIx = workerPool.indexOf(instance);
        if (itemIx !== -1) {
            workerPool.splice(itemIx, 1);
        }
    }
}

/**
 * Добавляет воркер к указанному инстансу
 */
 function attachWorker(instance: WorkerInstance) {
    getWorkerUrl().then(url => {
        const worker = new Worker(url, { type: 'module' });

        const cleanUp = () => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
        };

        const onMessage = (evt: MessageEvent<{ type?: string }>) => {
            if (evt.data.type === 'init') {
                cleanUp();

                if (workerPool.includes(instance)) {
                    instance.attach(worker);
                } else {
                    // Инстанс больше не нужен
                    worker.terminate();
                    instance.fail(terminateErr());
                }
            }
        };

        const onError = (evt: ErrorEvent) => {
            cleanUp();
            instance.fail(new Error(evt.error || evt.message));
        };

        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
    });
}

/**
 * Возвращает промис со ссылкой на воркер
 */
 function getWorkerUrl(): Promise<string> {
    if (!workerUrlLoader) {
        const entry = getConfig().workerUrl;
        let workerUrl: string | Promise<string> = typeof entry === 'function' ? entry() : entry;
        if (typeof workerUrl === 'string') {
            workerUrlLoader = Promise.resolve(workerUrl);
        } else {
            workerUrlLoader = workerUrl;
        }
    }

    return workerUrlLoader;
}

function terminateErr() {
    return new Error('ETERMINATE');
}
