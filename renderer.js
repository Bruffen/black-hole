import { shaderCompute } from "./shaders/shaders.js";
import { mat4 } from "./math.js"

export class Renderer {
    constructor(device, canvas, texture) {
        this.device = device;
        this.canvas = canvas;
        this.context = canvas.getContext('webgpu');
        this.texture = texture
        this.aspect = this.canvas.width / this.canvas.height;

        this.cameraFOV = 60.0
        this.cameraPosition  = new Float32Array([0, 0, -1e9]); // TODO
        this.matrixView = mat4.translation(this.cameraPosition);
        this.matrixProjection = mat4.perspective(
            this.cameraFOV,
            this.aspect,
            1,      // zNear
            2000,   // zFar
        );

        this.setup();
    }
    
    setup() {
        this.context.configure({
            device: this.device,
            format: 'rgba8unorm',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
        });

        const module = this.device.createShaderModule({
            label: 'compute module',
            code: shaderCompute,
        });

        this.pipeline = this.device.createComputePipeline({
            label: 'compute pipeline',
            layout: 'auto',
            compute: {
                module,
            },
        });

        const projection = mat4.perspective(
            this.cameraFOV,
            this.aspect,
            1,      // zNear
            2000,   // zFar
        );

        const matrixCount = 16;
        const uniformBufferCount = matrixCount * 2;
        const uniformBufferBytes = uniformBufferCount * 4;
        this.uniformBuffer = this.device.createBuffer({
            label: 'uniform buffer',
            size: (16 * 2 + 4) * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.bindData = this.device.createBindGroup({
            label: 'bind group for data',
            layout: this.pipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: this.uniformBuffer },
            ],
        });
    }

    render() {
        // TODO avoid creating the whole bind group every frame due to this.context.getCurrentTexture()
        this.bindTextures = this.device.createBindGroup({
            label: 'bind group for textures',
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.context.getCurrentTexture().createView() },
                { binding: 1, resource: this.texture.createView() },
            ],
        });

        this.matrixProjection = mat4.perspective(
            this.cameraFOV,
            this.aspect,
            1,
            2000,
        );
        const projectionInverse = mat4.inverse(this.matrixProjection);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, projectionInverse)
        this.device.queue.writeBuffer(this.uniformBuffer, 16 * 4, mat4.inverse(this.matrixView))
        this.device.queue.writeBuffer(this.uniformBuffer, 16 * 4 * 2, new Float32Array([this.canvas.width, this.canvas.height, 0.0, 0.0]))

        const encoder = this.device.createCommandEncoder({
            label: 'encoder',
        });
        const pass = encoder.beginComputePass({
            label: 'compute pass',
        });

        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindTextures);
        pass.setBindGroup(1, this.bindData);
        pass.dispatchWorkgroups(Math.ceil(this.canvas.width / 8.0), Math.ceil(this.canvas.height / 8.0));
        pass.end();
        const commandBuffer = encoder.finish();
        this.device.queue.submit([commandBuffer]);

        requestAnimationFrame(() => this.render());
    }
}