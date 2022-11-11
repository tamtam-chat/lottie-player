/** @type {import('vite').UserConfig} */
export default {
    build: {
        outDir: './dist',
        assetsDir: '',
        sourcemap: true,
        lib: {
            entry: './src/player.ts',
            formats: ['es'],
            fileName: 'player'
        },
    },
    worker: {
        rollupOptions: {
            output: {
                entryFileNames: '[name].js'
            }
        }
    }
}
