import { Component, type ReactNode } from 'react';
import { DialogoAviso } from '../avisos-problema/DialogoAviso.js';
import { anotarError, describir } from '../avisos-problema/ultimoError.js';
import { Boton } from '../ui/Boton.js';
import { unir } from '../ui/clases.js';
import { Vidrio } from '../ui/Vidrio.js';

export interface LimiteDeErroresProps {
  children: ReactNode;
  /** Ocupa toda la ventana (alrededor del marco); si no, el lugar de la pantalla. */
  completo?: boolean;
  /** Por defecto recarga la página. */
  alRecargar?: () => void;
}

interface Estado { fallo: boolean; error: string | null; avisando: boolean }

/**
 * Ante una excepción de render muestra «Algo salió mal en esta pantalla» con «Recargar», en lugar de dejar
 * la app en blanco. El detalle del error queda en la consola del navegador (React lo informa).
 */
export class LimiteDeErrores extends Component<LimiteDeErroresProps, Estado> {
  state: Estado = { fallo: false, error: null, avisando: false };

  /** El error queda en el estado del límite: el aviso adjunta este, no el último de toda la app. */
  static getDerivedStateFromError(error: unknown): Partial<Estado> {
    return { fallo: true, error: describir(error) };
  }

  /** Se anota para adjuntarlo, si la persona avisa el problema. */
  componentDidCatch(error: unknown): void {
    anotarError(error);
  }

  render(): ReactNode {
    if (!this.state.fallo) return this.props.children;
    const recargar = this.props.alRecargar ?? (() => window.location.reload());
    return (
      <div className={unir('limite-errores', this.props.completo === true && 'limite-errores--completo')}>
        <Vidrio variante="denso" role="alert" className="limite-errores__caja">
          <h2 className="limite-errores__titulo">Algo salió mal en esta pantalla</h2>
          <p className="limite-errores__texto">Lo que ya se guardó en OpenProject sigue ahí.</p>
          <div className="limite-errores__botones">
            <Boton variante="primario" onClick={recargar}>Recargar</Boton>
            <Boton variante="secundario" onClick={() => this.setState({ avisando: true })}>Avisar este problema</Boton>
          </div>
        </Vidrio>
        {this.state.avisando && <DialogoAviso error={this.state.error ?? undefined} onCerrar={() => this.setState({ avisando: false })} />}
      </div>
    );
  }
}
