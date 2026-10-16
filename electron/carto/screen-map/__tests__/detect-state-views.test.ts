import { describe, expect, it } from 'vitest';
import {
  detectStateViews,
  formatValueName,
  formatFlagName,
  formatDefaultComponentName,
} from '../detect-state-views';

describe('detect-state-views', () => {
  it('formatea nombres legibles para valores, banderas y componentes por omisión', () => {
    expect(formatValueName('AiHistory')).toBe('Ai history');
    expect(formatValueName('settings')).toBe('Settings');
    expect(formatValueName('user-profile')).toBe('User profile');
    expect(formatFlagName('cartographyActive')).toBe('Cartography');
    expect(formatFlagName('sidebarOpen')).toBe('Sidebar');
    expect(formatFlagName('editMode')).toBe('Edit');
    expect(formatDefaultComponentName('GraphTabView')).toBe('Graph');
    expect(formatDefaultComponentName('SettingsPanel')).toBe('Settings');
    expect(formatDefaultComponentName('PipelineWorkspace')).toBe('Pipeline');
  });

  it('reconoce la cadena de vistas con la forma real de RepoMainView', () => {
    const mainViewContent = `
import { SettingsPanel } from '@/components/SettingsPanel';
import { HelpPanel } from '@/components/HelpPanel';
import { ProfilePanel } from '@/components/ProfilePanel';
import { CartographyView } from '@/components/cartography/CartographyView';
import { PipelineWorkspace } from '@/components/pipeline/PipelineWorkspace';

export function RepoMainView(props: any) {
  if (cartographyActive) return <CartographyView repoPath={cartographyRepoPath} onExit={onExitCartography} />;
  if (activeView === 'settings') return <SettingsPanel {...settingsPanel} />;
  if (activeView === 'help') return <HelpPanel {...helpPanel} />;
  if (activeView === 'profile') return <ProfilePanel {...profilePanel} />;
  if (tabViews.activeTab === 'Pipeline') {
    return (
      <PipelineWorkspace repoPath={tabViews.repoPath} />
    );
  }
  return <GraphTabView tabViews={tabViews} graphView={graphView} />;
}

function GraphTabView(props: any) {
  return <div>Grafo</div>;
}
`;

    const knownPaths = [
      'components/RepoMainView.tsx',
      'components/SettingsPanel.tsx',
      'components/HelpPanel.tsx',
      'components/ProfilePanel.tsx',
      'components/cartography/CartographyView.tsx',
      'components/pipeline/PipelineWorkspace.tsx',
    ];

    const screens = detectStateViews(
      [{ path: 'components/RepoMainView.tsx', text: mainViewContent }],
      knownPaths,
    );

    // Salen Cartography, Settings, Help, Profile, Pipeline y Graph (por omisión)
    expect(screens).toHaveLength(6);

    const names = screens.map((s) => s.name);
    expect(names).toEqual(['Cartography', 'Settings', 'Help', 'Profile', 'Pipeline', 'Graph']);

    // CartographyView resuelto por import
    const carto = screens.find((s) => s.name === 'Cartography')!;
    expect(carto.locator).toBe('cartographyActive');
    expect(carto.id).toBe('view:components/RepoMainView.tsx#cartographyActive');
    expect(carto.declaredIn).toBe('components/RepoMainView.tsx');
    expect(carto.entryFiles).toEqual([
      { path: 'components/cartography/CartographyView.tsx', provenance: 'static', role: 'screen' },
    ]);

    // SettingsPanel resuelto por import
    const settings = screens.find((s) => s.name === 'Settings')!;
    expect(settings.locator).toBe('activeView=settings');
    expect(settings.id).toBe('view:components/RepoMainView.tsx#activeView=settings');
    expect(settings.entryFiles).toEqual([
      { path: 'components/SettingsPanel.tsx', provenance: 'static', role: 'screen' },
    ]);

    // PipelineWorkspace con bloque { return (
    const pipeline = screens.find((s) => s.name === 'Pipeline')!;
    expect(pipeline.locator).toBe('tabViews.activeTab=Pipeline');
    expect(pipeline.id).toBe('view:components/RepoMainView.tsx#tabViews.activeTab=Pipeline');
    expect(pipeline.entryFiles).toEqual([
      { path: 'components/pipeline/PipelineWorkspace.tsx', provenance: 'static', role: 'screen' },
    ]);

    // GraphTabView es la vista por omisión, definida en el mismo archivo → ese archivo, static
    const graph = screens.find((s) => s.name === 'Graph')!;
    expect(graph.locator).toBe('default');
    expect(graph.id).toBe('view:components/RepoMainView.tsx#default');
    expect(graph.entryFiles).toEqual([
      { path: 'components/RepoMainView.tsx', provenance: 'static', role: 'screen' },
    ]);
  });

  it('la vista por omisión sale de la misma función, no se repite y no choca entre archivos (lo encontrado en GitCron real)', () => {
    const sdd = `
export function StartScreens() {
  if (view === 'in-progress') return <InProgressStartScreen />;
  if (view === 'archived') return <ArchivedStartScreen />;
  if (view === 'new-change') return <NewChangeStartScreen />;
  return <NewChangeStartScreen />;
}
function InProgressStartScreen() { return <div />; }
function ArchivedStartScreen() { return <div />; }
function NewChangeStartScreen() { return <div />; }
export function Otra() {
  return <OtraCosa />;
}
`;
    const main = `
export function Main() {
  if (a === 'x') return <X />;
  if (a === 'y') return <Y />;
  if (a === 'z') return <Z />;
  return <GraphTabView />;
}
`;
    const screens = detectStateViews([
      { path: 'components/StartScreens.tsx', text: sdd },
      { path: 'components/Main.tsx', text: main },
    ]);
    const sddScreens = screens.filter((s) => s.declaredIn === 'components/StartScreens.tsx');
    // La de omisión repite NewChangeStartScreen: no se agrega otra; tampoco «OtraCosa», de otra función.
    expect(sddScreens.map((s) => s.name)).toEqual(['In progress', 'Archived', 'New change']);
    // Los componentes del mismo archivo se resuelven a ese archivo.
    expect(sddScreens[0].entryFiles).toEqual([{ path: 'components/StartScreens.tsx', provenance: 'static', role: 'screen' }]);
    // Cada archivo tiene su propia vista por omisión, sin chocar ids.
    const ids = screens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screens.find((s) => s.id === 'view:components/Main.tsx#default')?.name).toBe('Graph');
  });

  it('un archivo con solo dos retornos no da nada', () => {
    const twoReturnsContent = `
import { ViewA } from './ViewA';
import { ViewB } from './ViewB';

export function ShortComponent() {
  if (activeView === 'a') return <ViewA />;
  if (activeView === 'b') return <ViewB />;
  return <DefaultView />;
}
`;
    const screens = detectStateViews([
      { path: 'components/ShortComponent.tsx', text: twoReturnsContent },
    ]);
    expect(screens).toEqual([]);
  });
});
