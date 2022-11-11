/** @type {import('vite').UserConfig} */
export default {
    build: {
        lib: {
            entry: './src/player.ts',
            formats: ['es']
        },
        assetsInlineLimit: 500_000
    }
}
