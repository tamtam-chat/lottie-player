declare const Module = {
    /**
     * Обертка для проброса методов из бинарника
     */
    cwrap: (fnName: string, returnType: string, args: string[]) => unknown,
    /**
     * Хук для определения состояния готовности wasm инфраструктуры и воркера
     */
    onRuntimeInitialized: () => undefined,
    /**
     * Выделяет память в wasm куче для последующей работой с ней, возвращает указатель на кучу
     */
    allocate: (slab: number, types: string, allocator: number, ptr?: number) => number,
    /**
     * Создает буфер из строки в нужной размерности бит
     */
    intArrayFromString: (str: string) => number,
    /**
     * Прочие служебные методы работы с бинарным модуляем
     * @FIXME: Поправить тайпинги и аннотации
     */
    run: () => void 0,
    preInit: () => void 0,
    locateFile: () => void 0,
    inspect: () => void 0,
    print: () => void 0,
    printErr: () => void 0,
    HEAPU8: unknown,
    arguments: unknown,
    thisProgram: unknown,
    quit: unknown,
}

export {
    Module
}
