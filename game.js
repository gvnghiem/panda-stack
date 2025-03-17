const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Set canvas size
canvas.width = 800;
canvas.height = 600;

// Game variables
let pandas = [];
let fallingPanda = null;
let lives = 3;
let score = 0;
let cameraY = 0;
const pandaWidth = 50;
const pandaHeight = 50;
const gravity = 2;
const halfScreenHeight = canvas.height / 2; // 300px (50% of screen)

// Load images
const pandaImg = new Image();
pandaImg.src = 'panda.png';

const grassImg = new Image();
grassImg.src = 'grass.png';

const skyImg = new Image();
skyImg.src = 'sky.png';

// Load sound effects
const errorSound = new Audio('error.mp3');
const dropSound = new Audio('drop.mp3');
const pressSound = new Audio('press.mp3');

// Panda class
class Panda {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = pandaWidth;
        this.height = pandaHeight;
    }

    draw() {
        if (pandaImg.complete) {
            ctx.drawImage(pandaImg, this.x, this.y + cameraY, this.width, this.height);
        } else {
            ctx.fillStyle = 'black';
            ctx.fillRect(this.x, this.y + cameraY, this.width, this.height);
        }
    }

    update() {
        if (this.y + this.height + cameraY < canvas.height) {
            this.y += gravity;
        }
        if (this.x + this.width < 0) this.x = canvas.width - this.width;
        if (this.x > canvas.width) this.x = 0;
    }
}

// Spawn a new falling panda
function spawnPanda() {
    const x = Math.random() * (canvas.width - pandaWidth);
    fallingPanda = new Panda(x, -pandaHeight - cameraY);
}

// Calculate stack height based on unique y-positions
function getStackHeight() {
    if (pandas.length === 0) return 0;
    const uniqueYPositions = [...new Set(pandas.map(p => p.y))];
    const bottomY = Math.max(...uniqueYPositions);
    const topY = Math.min(...uniqueYPositions);
    return bottomY - topY + pandaHeight;
}

// Check collision and stacking
function checkStacking() {
    let landed = false;
    let prevStackHeight = getStackHeight();

    if (pandas.length === 0) {
        if (fallingPanda.y + fallingPanda.height + cameraY >= canvas.height) {
            fallingPanda.y = canvas.height - pandaHeight - cameraY;
            pandas.push(fallingPanda);
            score++;
            dropSound.play();
            fallingPanda = null;
            spawnPanda();
            landed = true;
        }
    } else {
        for (let i = pandas.length - 1; i >= 0; i--) {
            const p = pandas[i];
            if (fallingPanda.y + fallingPanda.height > p.y &&
                fallingPanda.y < p.y + p.height &&
                fallingPanda.x + fallingPanda.width > p.x &&
                fallingPanda.x < p.x + p.width) {
                if (fallingPanda.y + fallingPanda.height >= p.y &&
                    fallingPanda.y + fallingPanda.height <= p.y + gravity &&
                    fallingPanda.x + fallingPanda.width > p.x &&
                    fallingPanda.x < p.x + p.width) {
                    const wouldBeY = p.y - pandaHeight;
                    const overlapAtSameHeight = pandas.some(other =>
                        other !== p &&
                        other.y === wouldBeY &&
                        (fallingPanda.x < other.x + other.width && fallingPanda.x + fallingPanda.width > other.x)
                    );

                    if (!overlapAtSameHeight) {
                        fallingPanda.y = p.y - pandaHeight;
                        pandas.push(fallingPanda);
                        score++;
                        dropSound.play();
                        fallingPanda = null;
                        spawnPanda();
                        landed = true;

                        const newStackHeight = getStackHeight();
                        if (newStackHeight > prevStackHeight && newStackHeight > halfScreenHeight) {
                            cameraY += pandaHeight;
                        }
                        break;
                    }
                }
                break;
            }
        }
    }
    return landed;
}

// Draw UI (lives and score)
function drawUI() {
    ctx.font = '20px Arial';
    ctx.fillStyle = 'red';
    ctx.fillText(`Lives: ${'♥'.repeat(lives)}`, 10, 30);
    ctx.fillStyle = 'black';
    ctx.fillText(`Score: ${score}`, canvas.width / 2 - 30, 30);
}

// Game loop
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (skyImg.complete) {
        ctx.drawImage(skyImg, 0, -cameraY, canvas.width, canvas.height + cameraY);
    } else {
        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (grassImg.complete) {
        const grassHeight = grassImg.height;
        ctx.drawImage(grassImg, 0, canvas.height - grassHeight + cameraY, canvas.width, grassHeight);
    } else {
        ctx.fillStyle = 'green';
        ctx.fillRect(0, canvas.height - 50 + cameraY, canvas.width, 50);
    }

    if (!fallingPanda && pandas.length === 0) spawnPanda();
    if (fallingPanda) {
        fallingPanda.update();
        fallingPanda.draw();
    }

    pandas.forEach(panda => panda.draw());

    if (fallingPanda) {
        if (fallingPanda.y + fallingPanda.height + cameraY >= canvas.height) {
            if (!checkStacking()) {
                lives--;
                errorSound.play();
                fallingPanda = null;
                if (lives <= 0) {
                    alert(`Game Over! Score: ${score}`);
                    lives = 3;
                    score = 0;
                    pandas = [];
                    cameraY = 0;
                } else {
                    spawnPanda();
                }
            }
        } else {
            checkStacking();
        }
    }

    drawUI();
    requestAnimationFrame(gameLoop);
}

// Keyboard controls
document.addEventListener('keydown', (e) => {
    if (fallingPanda) {
        if (e.key === 'ArrowLeft') {
            fallingPanda.x -= 10;
            pressSound.play();
        }
        if (e.key === 'ArrowRight') {
            fallingPanda.x += 10;
            pressSound.play();
        }
    }
});

// Touch controls for iOS/iPad
let touchStartX = null;

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    console.log('Touch started at:', touchStartX);
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (fallingPanda && touchStartX !== null) {
        const touch = e.touches[0];
        const touchX = touch.clientX;
        const deltaX = touchX - touchStartX;

        if (deltaX > 10) { // Swipe right
            fallingPanda.x += 10;
            pressSound.play();
            touchStartX = touchX; // Update start point to avoid jitter
        } else if (deltaX < -10) { // Swipe left
            fallingPanda.x -= 10;
            pressSound.play();
            touchStartX = touchX;
        }
    }
});

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    touchStartX = null; // Reset on touch end
});

// Start the game
gameLoop();
