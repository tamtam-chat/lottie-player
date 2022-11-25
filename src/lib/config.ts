import { Config } from '../types';
import RLottieWorker from '../worker?worker&url';

const config: Config = {
    maxWorkers: 4,
    playersPerWorker: 5,
    workerUrl: RLottieWorker,
    cacheFrames: false
};

/**
 * Обновление параметров контроллера плеера
 */
 export function updateConfig(data: Partial<Config>): void {
    Object.assign(config, data);
}

/**
 * Возвращает текущий конфиг
 */
export function getConfig(): Config {
    return config;
}
