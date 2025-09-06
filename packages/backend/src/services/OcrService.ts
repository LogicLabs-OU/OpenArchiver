import { createScheduler, createWorker, Scheduler } from 'tesseract.js';
import { config } from '../config';
import { logger } from '../config/logger';

class OcrService {
    private static instance: OcrService;
    private scheduler: Scheduler | null = null;
    private isInitialized = false;

    private constructor() { }

    public static getInstance(): OcrService {
        if (!OcrService.instance) {
            OcrService.instance = new OcrService();
        }
        return OcrService.instance;
    }

    private async initialize(): Promise<void> {
        if (this.isInitialized || !config.app.ocrEnabled) {
            return;
        }

        logger.info('Initializing OCR Service...');
        this.scheduler = createScheduler();
        const languages = config.app.ocrLanguages.split(',');
        const numWorkers = Math.max(1, require('os').cpus().length - 1);

        const workerPromises = Array.from({ length: numWorkers }).map(async () => {
            const worker = await createWorker(languages, 1, {
                cachePath: '/usr/src/app/tessdata',
            });
            this.scheduler!.addWorker(worker);
        });

        await Promise.all(workerPromises);
        this.isInitialized = true;
        logger.info(
            `OCR Service initialized with ${numWorkers} workers for languages: [${languages.join(', ')}]`
        );
    }

    public async recognize(buffer: Buffer): Promise<string> {
        if (!config.app.ocrEnabled) return '';
        if (!this.isInitialized) await this.initialize();
        if (!this.scheduler) {
            logger.error('OCR scheduler not available.');
            return '';
        }
        try {
            const {
                data: { text },
            } = await this.scheduler.addJob('recognize', buffer);
            return text;
        } catch (error) {
            logger.error({ err: error }, 'Error during OCR processing');
            return '';
        }
    }

    public async terminate(): Promise<void> {
        if (this.scheduler && this.isInitialized) {
            logger.info('Terminating OCR Service...');
            await this.scheduler.terminate();
            this.scheduler = null;
            this.isInitialized = false;
        }
    }
}

export const ocrService = OcrService.getInstance();
