import { Router } from 'express';
import { requireAdmin } from '../controllers/auth.controller.js';
import {
  getAudienceOverview,
  getConfiguratorFunnel,
  getExitPoints,
  getJourneySummary,
  getConversionRates,
  getEntryRate,
  getAudienceGrowth,
  getExecutiveSummary,
  getVisitors,
} from '../controllers/reports.controller.js';

const router = Router();
router.use(requireAdmin);

router.get('/audience-overview', getAudienceOverview);
router.get('/configurator-funnel', getConfiguratorFunnel);
router.get('/exit-points', getExitPoints);
router.get('/journey-summary', getJourneySummary);
router.get('/conversion-rates', getConversionRates);
router.get('/entry-rate', getEntryRate);
router.get('/audience-growth', getAudienceGrowth);
router.get('/executive-summary', getExecutiveSummary);
router.get('/visitors', getVisitors);

export default router;

