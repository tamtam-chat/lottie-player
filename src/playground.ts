import { createPlayer, updateConfig, getInternals } from './player';
import acrobatics from './assets/acrobatics.json?inline';
import emojiWink from './assets/emoji_wink.json?inline';
import heart from './assets/heart.json?url';
import loader from './assets/gradient_sleepy_loader.json?inline';

const app = document.getElementById('app')!
const controls = document.getElementById('controls')!;

let width = 100;
let height = 100;

interface MovieOptions {
    id?: string;
    movie: string | object;
    width: number;
    height: number;
    loop?: boolean;
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

    canvas.addEventListener('click', () => {
        canvas.remove();
        player.dispose();
        console.log('disposed player');
    });

    return player;
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
    playersPerWorker: 2
});

createControls();
