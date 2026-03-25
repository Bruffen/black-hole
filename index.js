import { Renderer } from './renderer.js'
import { mat4 } from "./math.js"

async function loadImageBitmap(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
}

async function start() {
    const canvas = document.querySelector('#c');

    let style = getComputedStyle(canvas);
    const width = style.width.replace(/[^0-9]/g, '');
    const height = style.height.replace(/[^0-9]/g, '');
    const aspect = width / height;
    
    if (!navigator.gpu) {
        alert('This browser does not support WebGPU.');
        return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        alert('This browser supports webgpu but it appears disabled.');
        return;
    }

    const device = await adapter?.requestDevice({
        //requiredFeatures: [ 'float32-filterable' ],
    });

    device.lost.then((info) => {
        console.error(`WebGPU device was lost: ${info.message}`);
        if (info.reason !== 'destroyed') {
            start();
        }
    });

    const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
        const width = entry.devicePixelContentBoxSize?.[0].inlineSize ||
                        entry.contentBoxSize[0].inlineSize * devicePixelRatio;
        const height = entry.devicePixelContentBoxSize?.[0].blockSize ||
                        entry.contentBoxSize[0].blockSize * devicePixelRatio;
        const canvas = entry.target;
        canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
        canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
        }
    });
    try {
        observer.observe(canvas, { box: 'device-pixel-content-box' });
    } catch {
        observer.observe(canvas, { box: 'content-box' });
    }

    const url = 'starmap_2020_8k_gal.png';
    const source = await loadImageBitmap(url);
    const texture = device.createTexture({
        label: url,
        format: 'rgba32float',
        size: [source.width, source.height],
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source, flipY: true },
        { texture },
        { width: source.width, height: source.height },
    );

    const renderer = new Renderer(device, canvas, texture);
    
    canvas.addEventListener('wheel', function(e) {
        renderer.cameraFOV += e.deltaY * 0.01;
        renderer.cameraFOV = Math.min(Math.max(renderer.cameraFOV, 1.0), 179.0);

        return false;
    });

    var isMouseDown = false;
    var xpos, ypos;

    canvas.addEventListener('mousedown', function(e) {
        isMouseDown = true;
        const rect = canvas.getBoundingClientRect()
        xpos = e.clientX - rect.left;
        ypos = e.clientY - rect.top;
    });

    canvas.addEventListener('mouseup', function() {
        isMouseDown = false;
    });

    const speed = 0.004;
    var rotx = 0.0;
    var roty = 0.0;
    canvas.addEventListener('mousemove', function(e) {
        if (isMouseDown) {
            const rect = canvas.getBoundingClientRect()
            var newxpos = e.clientX - rect.left;
            var newypos = e.clientY - rect.top;

            roty += (newxpos - xpos) * speed;
            rotx -= (newypos - ypos) * speed;
            let matRotation = mat4.multiply(mat4.rotationY(roty), mat4.rotationX(rotx));
            mat4.multiply(
                mat4.translation(renderer.cameraPosition),
                matRotation, 
                renderer.matrixView
            );

            xpos = newxpos;
            ypos = newypos;
        }
    });

    renderer.render()
}

start();