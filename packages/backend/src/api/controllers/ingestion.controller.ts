import { Request, Response } from 'express';
import { IngestionService } from '../../services/IngestionService';
import {
	CreateIngestionSourceDto,
	UpdateIngestionSourceDto,
	IngestionSource,
	SafeIngestionSource,
} from '@open-archiver/types';
import { logger } from '../../config/logger';
import { config } from '../../config';

export class IngestionController {
	/**
	 * Converts an IngestionSource object to a safe version for client-side consumption
	 * by removing the credentials.
	 * @param source The full IngestionSource object.
	 * @returns An object conforming to the SafeIngestionSource type.
	 */
	private toSafeIngestionSource(source: IngestionSource): SafeIngestionSource {
		const { credentials, ...safeSource } = source;
		return safeSource;
	}

	public create = async (req: Request, res: Response): Promise<Response> => {
		if (config.app.isDemo) {
			return res.status(403).json({ message: 'This operation is not allowed in demo mode.' });
		}
		try {
			const dto: CreateIngestionSourceDto = req.body;
			const userId = req.user?.sub;
			if (!userId) {
				return res.status(401).json({ message: 'Unauthorized' });
			}
			const newSource = await IngestionService.create(dto, userId);
			const safeSource = this.toSafeIngestionSource(newSource);
			return res.status(201).json(safeSource);
		} catch (error: any) {
			logger.error({ err: error }, 'Create ingestion source error');
			// Return a 400 Bad Request for connection errors
			return res.status(400).json({
				message:
					error.message || 'Failed to create ingestion source due to a connection error.',
			});
		}
	};

	public findAll = async (req: Request, res: Response): Promise<Response> => {
		try {
			const userId = req.user?.sub;
			if (!userId) {
				return res.status(401).json({ message: 'Unauthorized' });
			}
			const sources = await IngestionService.findAll(userId);
			const safeSources = sources.map(this.toSafeIngestionSource);
			return res.status(200).json(safeSources);
		} catch (error) {
			console.error('Find all ingestion sources error:', error);
			return res.status(500).json({ message: 'An internal server error occurred' });
		}
	};

	public findById = async (req: Request, res: Response): Promise<Response> => {
		try {
			const { id } = req.params;
			const source = await IngestionService.findById(id);
			const safeSource = this.toSafeIngestionSource(source);
			return res.status(200).json(safeSource);
		} catch (error) {
			console.error(`Find ingestion source by id ${req.params.id} error:`, error);
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: error.message });
			}
			return res.status(500).json({ message: 'An internal server error occurred' });
		}
	};

	public update = async (req: Request, res: Response): Promise<Response> => {
		if (config.app.isDemo) {
			return res.status(403).json({ message: 'This operation is not allowed in demo mode.' });
		}
		try {
			const { id } = req.params;
			const dto: UpdateIngestionSourceDto = req.body;
			const updatedSource = await IngestionService.update(id, dto);
			const safeSource = this.toSafeIngestionSource(updatedSource);
			return res.status(200).json(safeSource);
		} catch (error) {
			console.error(`Update ingestion source ${req.params.id} error:`, error);
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: error.message });
			}
			return res.status(500).json({ message: 'An internal server error occurred' });
		}
	};

	public delete = async (req: Request, res: Response): Promise<Response> => {
		if (config.app.isDemo) {
			return res.status(403).json({ message: 'This operation is not allowed in demo mode.' });
		}
		try {
			const { id } = req.params;
			await IngestionService.delete(id);
			return res.status(204).send();
		} catch (error) {
			console.error(`Delete ingestion source ${req.params.id} error:`, error);
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: error.message });
			}
			return res.status(500).json({ message: 'An internal server error occurred' });
		}
	};

	public triggerInitialImport = async (req: Request, res: Response): Promise<Response> => {
		if (config.app.isDemo) {
			return res.status(403).json({ message: 'This operation is not allowed in demo mode.' });
		}
		try {
			const { id } = req.params;
			await IngestionService.triggerInitialImport(id);
			return res.status(202).json({ message: 'Initial import triggered successfully.' });
		} catch (error) {
			console.error(`Trigger initial import for ${req.params.id} error:`, error);
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: error.message });
			}
			return res.status(500).json({ message: 'An internal server error occurred' });
		}
	};

	public pause = async (req: Request, res: Response): Promise<Response> => {
		if (config.app.isDemo) {
			return res.status(403).json({ message: 'This operation is not allowed in demo mode.' });
		}
		try {
			const { id } = req.params;
			const updatedSource = await IngestionService.update(id, { status: 'paused' });
			const safeSource = this.toSafeIngestionSource(updatedSource);
			return res.status(200).json(safeSource);
		} catch (error) {
			console.error(`Pause ingestion source ${req.params.id} error:`, error);
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: error.message });
			}
			return res.status(500).json({ message: 'An internal server error occurred' });
		}
	};

	public triggerForceSync = async (req: Request, res: Response): Promise<Response> => {
		if (config.app.isDemo) {
			return res.status(403).json({ message: 'This operation is not allowed in demo mode.' });
		}
		try {
			const { id } = req.params;
			await IngestionService.triggerForceSync(id);
			return res.status(202).json({ message: 'Force sync triggered successfully.' });
		} catch (error) {
			console.error(`Trigger force sync for ${req.params.id} error:`, error);
			if (error instanceof Error && error.message === 'Ingestion source not found') {
				return res.status(404).json({ message: error.message });
			}
			return res.status(500).json({ message: 'An internal server error occurred' });
		}
	};
}
