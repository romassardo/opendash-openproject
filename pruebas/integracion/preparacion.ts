// Se corre una vez por suite: el E2E (y las propias pruebas de integración) mutan las tareas sembradas,
// así que se resiembra el OpenProject de prueba igual que antes del E2E.
export { default } from '../e2e/preparacion.js';
