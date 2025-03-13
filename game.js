const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Set canvas size
canvas.width = 800;
canvas.height = 600;

// Game variables
let pandas = []; // Array to store stacked pandas
let fallingPanda = null;
let lives = 3;
let score = 0;
let cameraY = 0; // Camera offset for shifting view (positive = shift down)
const pandaWidth = 50;
const pandaHeight = 50;
const gravity = 2;
const halfScreenHeight = canvas.height / 2; // 300px (50% of screen)

const pandaImg = new Image();
pandaImg.src = 'panda.png';
// In Panda.draw():
draw() {
    ctx.drawImage(pandaImg, this.x, this.y + cameraY, this.width, this.height);
}
// Panda class
class Panda {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = pandaWidth;
        this.height = pandaHeight;
    }

    draw() {
        ctx.fillStyle = 'black'; // Replace with panda image later
        ctx.fillRect(this.x, this.y + cameraY, this.width, this.height);
        // To use an image: ctx.drawImage(pandaImg, this.x, this.y + cameraY, this.width, this.height);
    }

    update() {
        if (this.y + this.height + cameraY < canvas.height) {
            this.y += gravity;
        }
        // Wrap around borders
        if (this.x + this.width < 0) this.x = canvas.width - this.width;
        if (this.x > canvas.width) this.x = 0;
    }
}

// Spawn a new falling panda
function spawnPanda() {
    const x = Math.random() * (canvas.width - pandaWidth);
    fallingPanda = new Panda(x, -pandaHeight - cameraY); // Spawn above visible area
}

// Calculate stack height based on unique y-positions
function getStackHeight() {
    if (pandas.length === 0) return 0;
    const uniqueYPositions = [...new Set(pandas.map(p => p.y))]; // Unique y-values
    const bottomY = Math.max(...uniqueYPositions);
    const topY = Math.min(...uniqueYPositions);
    return bottomY - topY + pandaHeight; // Height based on unique positions
}

// Check if panda lands on stack or ground
function checkStacking() {
    let landed = false;
    let prevStackHeight = getStackHeight();

    if (pandas.length === 0) {
        // First panda lands on the ground
        if (fallingPanda.y + fallingPanda.height + cameraY >= canvas.height) {
            fallingPanda.y = canvas.height - pandaHeight - cameraY; // Snap to bottom
            pandas.push(fallingPanda);
            score++;
            fallingPanda = null;
            spawnPanda();
            landed = true;
        }
    } else {
        // Check stacking on top of existing pandas
        for (let i = pandas.length - 1; i >= 0; i--) {
            const p = pandas[i];
            if (fallingPanda.y + fallingPanda.height >= p.y &&
                fallingPanda.y + fallingPanda.height <= p.y + gravity && // Only stack if very close
                fallingPanda.x + fallingPanda.width > p.x &&
                fallingPanda.x < p.x + p.width) {
                fallingPanda.y = p.y - fallingPanda.height;
                // ... rest of stacking logic
            } // Snap to top of stack
                pandas.push(fallingPanda);
                score++;

                // Shift view down only if stack height increases and exceeds 50%
                let targetCameraY = cameraY;
                // In checkStacking(), replace cameraY += pandaHeight with:
                if (newStackHeight > prevStackHeight && newStackHeight > halfScreenHeight) {
                    targetCameraY += pandaHeight;
                }
                // In gameLoop(), add:
                if (cameraY < targetCameraY) {
                    cameraY += 2; // Adjust speed (e.g., 2px per frame)
                }
                fallingPanda = null;
                spawnPanda();
                landed = true;
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

    // Update and draw falling panda
    if (!fallingPanda && pandas.length === 0) spawnPanda(); // Start with first panda
    if (fallingPanda) {
        fallingPanda.update();
        fallingPanda.draw();
    }

    // Draw stacked pandas
    pandas.forEach(panda => panda.draw());

    // Check stacking or miss
    if (fallingPanda && fallingPanda.y + fallingPanda.height + cameraY >= canvas.height) {
        if (!checkStacking()) { // If it didn’t land on a panda (after first one)
            lives--;
            fallingPanda = null;
            if (lives <= 0) {
                alert(`Game Over! Score: ${score}`);
                lives = 3;
                score = 0;
                pandas = [];
                cameraY = 0; // Reset camera
            } else {
                spawnPanda();
            }
        }
    } else if (fallingPanda) {
        checkStacking();
    }

    drawUI();
    requestAnimationFrame(gameLoop);
}

// Move falling panda with arrow keys
document.addEventListener('keydown', (e) => {
    if (fallingPanda) {
        if (e.key === 'ArrowLeft') fallingPanda.x -= 10;
        if (e.key === 'ArrowRight') fallingPanda.x += 10;
    }
});

// Start the game
gameLoop();
