/** @return {import('vite').BuildOptions} */
function getBuildConfig() {
    if (process.env.BUILD === 'demo') {
        return {
            outDir: './public',
        }
    }

    if (process.env.BUILD === 'amd') {
        return {
            lib: {
                entry: './src/main.ts',
                formats: ['amd'],
                fileName: 'lottie-player',
                name: 'lottiePlayer'
            }
        }
    }

    return {
        lib: {
            entry: './src/main.ts',
            formats: ['es'],
            fileName: 'main'
        }
    };
}

/** @return {import('vite').ResolveWorkerOptions} */
function getWorkerConfig() {
    if (process.env.BUILD === 'amd') {
        return {
            format: 'es',
            rollupOptions: {
                output: {
                    entryFileNames: 'lottie-player-worker.js'
                }
            }
        }
    }

    return {
        format: process.env.BUILD === 'demo' ? 'es' : 'iife',
        rollupOptions: {
            output: {
                entryFileNames: '[name].js'
            }
        }
    }
}

/** @type {import('vite').UserConfig} */
export default {
    base: './',
    build: {
        outDir: './dist',
        assetsDir: '',
        sourcemap: true,
        target: 'es2018',
        ...getBuildConfig()
    },
    worker: {
        ...getWorkerConfig(),
    }
}
