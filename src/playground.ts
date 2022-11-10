import './assets/style.css';
import { createPlayer } from './player';
import animation from './assets/acrobatics.json?inline';

const button = document.getElementById('add-btn')!;
const app = document.getElementById('app')!
let width = 100;
let height = 100;

button.addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    width += 20;
    height += 20;

    app.appendChild(canvas);

    const player = createPlayer({
        id: 'test',
        canvas,
        movie: JSON.stringify(animation),
        loop: true
    });
    console.log('created player', player);

    canvas.addEventListener('click', () => {
        canvas.remove();
        player.dispose();
        console.log('disposed player');
    });
});
