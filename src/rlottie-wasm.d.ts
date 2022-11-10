declare class RlottieWasm {
    constructor(jsonData: string);

    /**
     * Загружает анимацию из указанного JSON-файла.
     * @returns `true` если анимация успешно загрузилась и может воспроизводиться
     */
    load(jsonData: string): boolean;

    /** Возвращает количество кадров у указанной анимации */
    frames(): number;

    /**
     * Отрисовывает указанный номер кадра (начиная с 0)
     */
    render(frame: number, width: number, height: number): Uint8Array;

    /**
     * Внутренний метод, добавляемый Emscripten, для удаления инстансов,
     * полученных из C++
     * https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html?highlight=typed_memory_view#memory-management
     */
    delete(): void;
}

const loader: Promise<{ RlottieWasm: typeof RlottieWasm }>;
export default loader;
export type { RlottieWasm };