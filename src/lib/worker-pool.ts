import type { WorkerInfo } from '../types';
import { getConfig } from './config';

const workerPool: WorkerInfo[] = [];
let workerUrlLoader: Promise<string> | undefined;

/**
 * Выделяет воркер для RLottie: либо создаёт новый, либо переиспользует существующий
 */
export function allocWorker(): WorkerInfo {
    const config = getConfig();
    let minPlayersWorker: WorkerInfo | undefined;
    for (let i = 0; i < workerPool.length; i++) {
        const info = workerPool[i];
        if (info.players < config.playersPerWorker) {
            info.players++;
            return info;
        }

        if (!minPlayersWorker || minPlayersWorker.players > info.players) {
            minPlayersWorker = info;
        }
    }

    // Если добрались сюда, значит, нет подходящего инстанса. Либо создадим новый,
    // либо будем превышать лимиты на существующих
    if (workerPool.length >= config.maxWorkers && minPlayersWorker) {
        minPlayersWorker.players++;
        return minPlayersWorker;
    }

    const w: WorkerInfo = {
        players: 1,
        loaded: false,
        queue: []
    };
    workerPool.push(w);
    attachWorker(w);
    return w;
}

/**
 * Освобождает указанный инстанс воркера
 */
export function releaseWorker(info: WorkerInfo) {
    info.players--;
    if (info.players <= 0) {
        const { worker } = info;
        if (worker) {
            info.worker = undefined;
            worker.removeEventListener('message', handleMessage);
            worker.terminate();
        }
        const itemIx = workerPool.indexOf(info);
        if (itemIx !== -1) {
            workerPool.splice(itemIx, 1);
        }
    }
}

/**
 * Добавляет воркер к указанному инстансу
 */
function attachWorker(info: WorkerInfo) {
    getWorkerUrl().then(url => {
        if (workerPool.includes(info)) {
            info.worker = new Worker(url, { type: 'module' });
            info.worker.addEventListener('message', handleMessage);
        }
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
