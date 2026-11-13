import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import adminAgentsHandler from '../api/admin/agentes';
import agentsHandler from '../api/agentes';
import authMeHandler from '../api/auth/me';
import carteraHandler from '../api/cartera';
import cliente360Handler from '../api/cliente360';
import configurationFieldsHandler from '../api/configuracion/campos';
import evaluationHandler from '../api/evaluar-gestion';
import catchAllApiHandler from '../api/[...path]';
import syncHandler from '../api/sync';
import syncStatusHandler from '../api/sync/status';
import syncClientesHandler from '../api/sync-clientes';
import syncContactosHandler from '../api/sync-contactos';
import { listPbxCallsHandler, pbxAudioHandler } from './routes/pbxCalls';

const app = express();
const port = Number(process.env.PORT) || 3000;
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Sistema de Cobranza RED' });
});

app.all('/api/cartera', (req, res) => carteraHandler(req, res));
app.all('/api/cliente360', (req, res) => cliente360Handler(req, res));
app.all('/api/sync', (req, res) => syncHandler(req, res));
app.all('/api/sync/status', (req, res) => syncStatusHandler(req, res));
app.all('/api/sync-clientes', (req, res) => syncClientesHandler(req, res));
app.all('/api/sync-contactos', (req, res) => syncContactosHandler(req, res));
app.all('/api/agentes', (req, res) => agentsHandler(req, res));
app.all('/api/admin/agentes', (req, res) => adminAgentsHandler(req, res));
app.all('/api/auth/me', (req, res) => authMeHandler(req, res));
app.all('/api/configuracion/campos', (req, res) => configurationFieldsHandler(req, res));
app.all('/api/evaluar-gestion', (req, res) => evaluationHandler(req, res));
app.all('/api/pbx/calls', (req, res) => listPbxCallsHandler(req, res));
app.all('/api/pbx/audio', (req, res) => pbxAudioHandler(req, res));
app.all('/api/*', (req, res) => catchAllApiHandler(req, res));

app.use(express.static(path.join(appRoot, 'dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(appRoot, 'dist', 'index.html'));
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Sistema de Cobranza RED escuchando en el puerto ${port}`);
});

server.on('error', (error) => {
  console.error('Server listen error:', error);
});

export default app;
