import { Router } from 'express';
import itemsRouter from './items';
import assetsRouter from './assets';
import warehousesRouter from './warehouses';
import countsRouter from './counts';
import movementsRouter from './movements';

const router = Router();

router.use('/items', itemsRouter);
router.use('/assets', assetsRouter);
router.use('/warehouses', warehousesRouter);
router.use('/counts', countsRouter);
router.use('/movements', movementsRouter);

export default router;
