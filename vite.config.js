/** @type {import('vite').UserConfig} */
export default {
    build: {
        outDir: './dist',
        assetsDir: '',
        sourcemap: true,
        lib: {
            entry: './src/main.ts',
            formats: ['es'],
            fileName: 'player'
        },
        target: 'es2018'
    },
    worker: {
        rollupOptions: {
            output: {
                entryFileNames: '[name].js'
            }
        }
    }
}
