import { createPlayer, updateConfig, getInternals, Player } from './main';
import { RenderStats } from './types';
import acrobatics from './assets/acrobatics.json?inline';
import emojiWink from './assets/emoji_wink.json?inline';
import heart from './assets/heart.json?url';
import loader from './assets/gradient_sleepy_loader.json?inline';
import textTyping from './assets/text.json?inline';

const fireMovie = 'https://st.mycdn.me/static/messages/2022-11-30lottie/e/10.json';

const app = document.getElementById('app')!
const controls = document.getElementById('controls')!;
const statsElem = document.getElementById('stats')!;
const statsItems: RenderStats[] = [];

let width = 100;
let height = 100;

interface MovieOptions {
    id?: string;
    movie: string | object;
    width: number;
    height: number;
    loop?: boolean;
    fill?: string;
}

function createMovie(opt: MovieOptions) {
    const canvas = document.createElement('canvas');
    canvas.width = opt.width;
    canvas.height = opt.height;

    app.appendChild(canvas);

    const player = createPlayer({
        ...opt,
        canvas,
        movie: typeof opt.movie === 'string'
            ? opt.movie : JSON.stringify(opt.movie),
    });

    canvas.addEventListener('click', evt => {
        if (evt.altKey) {
            player.toggle();
            console.log('toggle playback');
        } else {
            canvas.remove();
            player.dispose();
            console.log('disposed player');
        }
    });

    return player;
}

function createFire(amount: number) {
    const fire = document.createElement('div');
    fire.className = 'fire';
    const players: Player[] = [];
    let first = true;
    while (amount--) {
        const canvas = document.createElement('canvas');
        fire.appendChild(canvas);

        const player = createPlayer({
            width: first ? 50 : 20,
            height: first ? 50 : 20,
            id: 'fire',
            loop: true,
            canvas,
            movie: fireMovie,
        });
        players.push(player);
        first = false;
    }

    fire.addEventListener('click', () => {
        players.forEach(p => p.dispose());
        players.length = 0;
        fire.remove();
    });

    app.appendChild(fire);
}

function createButton(label: string, onClick?: (evt: MouseEvent) => void) {
    const btn = document.createElement('button');
    btn.innerText = label;
    if (onClick) {
        btn.addEventListener('click', onClick);
    }
    controls.append(btn);
    return btn;
}

function createControls() {
    createButton('Acrobatics', () => {
        createMovie({
            id: 'acrobatics',
            movie: acrobatics,
            loop: true,
            width,
            height
        });
        width += 20;
        height += 20;
    });

    // XXX загрузка внешних картинок пока не поддерживается
    // createButton('External image', () => {
    //     createMovie({
    //         movie: createExternalAnimation('https://st.mycdn.me/static/emoji/14-0-0/32/1f648@2x.png'),
    //         loop: true,
    //         width: 100,
    //         height: 100
    //     });
    // });

    createButton('Emoji wink', createMovieHandler(emojiWink));
    createButton('Heart', createMovieHandler(new URL(heart, location.href).href));
    createButton('Loader', createMovieHandler(loader, 'gradient'));
    createButton('Typing', () => {
        createMovie({
            id: 'typing',
            movie: textTyping,
            loop: true,
            width: 100,
            height: 100,
            fill: '#ccc'
        });
    });
    createButton('Fire', () => createFire(400));

    createButton('Log internals', () => console.log(getInternals()));
}

function createMovieHandler(movie: string | object, id?: string) {
    return () => createMovie({
        id,
        movie,
        loop: true,
        width: 100,
        height: 100
    });
}

// Для отладки сокращаем лимиты
updateConfig({
    maxWorkers: 3,
    playersPerWorker: 2,
    cacheFrames: true,
    maxRender: 100,
    stats(data) {
        statsItems.push(data);
        while (statsItems.length > 50) {
            statsItems.shift();
        }

        let frameTime = 0;
        let paintTime = 0;
        let tickDelta = 0;

        const avg = (value: number) => (value / statsItems.length).toFixed(2);

        statsItems.forEach(item => {
            frameTime += item.frameTime;
            paintTime += item.paintTime;
            tickDelta += item.tickDelta;
        });

        statsElem.innerHTML = `Frame time: ${avg(frameTime)}ms\nPaint time: ${avg(paintTime)}ms\nTick: ${avg(tickDelta)}ms`;
    }
});

function setupFilePicker() {
    const picker = document.getElementById('lottie-picker') as HTMLInputElement;
    if (picker) {
        picker.addEventListener('change', async () => {
            const file = picker.files?.[0];
            if (file) {
                const movie = await file.text();
                const movieData = JSON.parse(movie)

                createMovie({
                    width: movieData.w || 400,
                    height: movieData.h || 400,
                    movie,
                    loop: true
                });
                picker.value = '';
            }
        });
    }
}

createControls();
setupFilePicker();
