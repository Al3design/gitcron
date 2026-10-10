// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenSpecTasksView } from '../OpenSpecTasksView';
import type { OpenSpecChangeEvidence } from '@/types/pipeline';

describe('OpenSpecTasksView (Grupo 8: Tareas 8.1, 8.2, 8.4, 8.8, 8.12)', () => {
  const pipelineSetTaskChecked = vi.fn().mockResolvedValue({ success: true });
  const pipelineAddTask = vi.fn().mockResolvedValue({ success: true });
  const pipelineEditTask = vi.fn().mockResolvedValue({ success: true });
  const pipelineMoveTask = vi.fn().mockResolvedValue({ success: true });
  const pipelineRemoveTask = vi.fn().mockResolvedValue({ success: true });
  const pipelineWriteArtifact = vi.fn().mockResolvedValue({ success: true });
  const onRefresh = vi.fn();
  const setSuccess = vi.fn();

  const mockChange: OpenSpecChangeEvidence = {
    changeId: 'demo-change',
    intent: 'Probar tareas',
    proposalExists: true,
    designExists: true,
    specsCount: 1,
    validation: 'passed',
    tasks: [
      { id: '1.1', text: '1.1 Primera tarea', completed: false, line: 3, sourceRef: 'tasks.md' },
      { id: '1.2', text: '1.2 Segunda tarea', completed: true, line: 4, sourceRef: 'tasks.md' },
      { id: '1.3', text: '1.3 Tercera tarea', completed: false, line: 5, sourceRef: 'tasks.md' },
    ],
    artifacts: {
      proposal: '# Propuesta',
      design: '# Diseño',
      tasks: [
        '## 1. Grupo',
        '',
        '- [ ] 1.1 Primera tarea',
        '- [x] 1.2 Segunda tarea',
        '- [ ] 1.3 Tercera tarea',
      ].join('\n'),
      specs: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pipelineSetTaskChecked,
        pipelineAddTask,
        pipelineEditTask,
        pipelineMoveTask,
        pipelineRemoveTask,
        pipelineWriteArtifact,
      },
    });
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  function renderView(change: OpenSpecChangeEvidence = mockChange) {
    return render(
      <OpenSpecTasksView
        repoPath="C:/repo"
        selectedChange={change}
        onRefresh={onRefresh}
        setSuccess={setSuccess}
      />,
    );
  }

  // Helper para abrir el menú de 3 puntos de la tarea i-ésima (0-indexed)
  function openTaskMenu(index = 0) {
    const moreButtons = screen.getAllByRole('button', { name: /Más opciones/i });
    fireEvent.click(moreButtons[index]);
  }

  // --- Tarea 8.1 y Bloque A: Agregar, editar con textarea multilínea y atajos ---
  describe('Operaciones de lista (Tarea 8.1 y Bloque A)', () => {
    it('agrega una nueva tarea al final consumiendo pipelineAddTask', async () => {
      renderView();

      fireEvent.click(screen.getByRole('button', { name: /Nueva tarea/i }));
      const input = screen.getByPlaceholderText(/Descripción de la nueva tarea/i);
      fireEvent.change(input, { target: { value: '1.4 Nueva tarea agregada' } });

      fireEvent.click(screen.getByRole('button', { name: /^Agregar$/i }));

      await waitFor(() => {
        expect(pipelineAddTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          '1.4 Nueva tarea agregada',
          { position: 'end' },
          'persona',
        );
      });
      expect(onRefresh).toHaveBeenCalled();
    });

    it('edita el texto de una tarea en textarea multilínea y guarda con botón', async () => {
      renderView();

      const [editBtn] = screen.getAllByRole('button', { name: /^Editar tarea$/i });
      fireEvent.click(editBtn);

      const textarea = screen.getByDisplayValue('Primera tarea');
      expect(textarea.tagName.toLowerCase()).toBe('textarea');
      fireEvent.change(textarea, { target: { value: 'Primera tarea editada\ncon párrafos' } });

      fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

      await waitFor(() => {
        expect(pipelineEditTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          3,
          '1.1 Primera tarea',
          '1.1 Primera tarea editada\ncon párrafos',
          'persona',
        );
      });
      expect(onRefresh).toHaveBeenCalled();
    });

    it('guarda la edición con Ctrl+Enter y cancela con Escape (Bloque A)', async () => {
      renderView();

      const [editBtn] = screen.getAllByRole('button', { name: /^Editar tarea$/i });
      fireEvent.click(editBtn);

      const textarea = screen.getByDisplayValue('Primera tarea');
      fireEvent.change(textarea, { target: { value: 'Texto modificado' } });

      // Atajo Ctrl+Enter guarda
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

      await waitFor(() => {
        expect(pipelineEditTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          3,
          '1.1 Primera tarea',
          '1.1 Texto modificado',
          'persona',
        );
      });

      // Abrir edición de nuevo y cancelar con Escape
      const [editBtn2] = screen.getAllByRole('button', { name: /^Editar tarea$/i });
      fireEvent.click(editBtn2);

      const textarea2 = screen.getByDisplayValue('Primera tarea');
      fireEvent.keyDown(textarea2, { key: 'Escape' });

      expect(screen.queryByDisplayValue('Primera tarea')).toBeNull();
    });

    it('muestra la columna vacía y no el ID interno cuando la tarea no tiene número (Tarea 4.11a)', () => {
      const changeWithoutNum: OpenSpecChangeEvidence = {
        ...mockChange,
        tasks: [
          { id: 'c4cd52fad0278bc8e894', text: 'Tarea sin número alguno', completed: false, line: 3, sourceRef: 'tasks.md' },
        ],
      };
      renderView(changeWithoutNum);

      // No debe mostrarse el ID interno bajo ningún concepto
      expect(screen.queryByText('c4cd52fad0278bc8e894')).toBeNull();
      // El texto de la tarea sí está presente
      expect(screen.getByText('Tarea sin número alguno')).toBeTruthy();
    });

    it('agregar tarea precarga el número sugerido pero permite vaciarlo para guardar sin número (Tarea 4.11b)', async () => {
      renderView();

      fireEvent.click(screen.getByRole('button', { name: /Nueva tarea/i }));
      const numberInput = screen.getByLabelText(/N°/i);
      const textInput = screen.getByPlaceholderText(/Descripción de la nueva tarea/i);

      // Precarga el siguiente sugerido (1.4 porque mockChange tiene 1.1, 1.2, 1.3)
      expect((numberInput as HTMLInputElement).value).toBe('1.4');

      // Vaciamos el campo de número
      fireEvent.change(numberInput, { target: { value: '' } });
      fireEvent.change(textInput, { target: { value: 'Tarea completamente sin número' } });

      fireEvent.click(screen.getByRole('button', { name: /^Agregar$/i }));

      await waitFor(() => {
        expect(pipelineAddTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          'Tarea completamente sin número',
          { position: 'end' },
          'persona',
        );
      });
    });

    it('editar una tarea permite modificar su número en su propio campo (Tarea 4.11c)', async () => {
      renderView();

      const [editBtn] = screen.getAllByRole('button', { name: /^Editar tarea$/i });
      fireEvent.click(editBtn);

      const numberInput = screen.getByLabelText(/N°/i);
      expect((numberInput as HTMLInputElement).value).toBe('1.1');

      // Cambiar el número de 1.1 a 1.9
      fireEvent.change(numberInput, { target: { value: '1.9' } });
      const textarea = screen.getByDisplayValue('Primera tarea');
      fireEvent.change(textarea, { target: { value: 'Primera tarea renumerada' } });

      fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

      await waitFor(() => {
        expect(pipelineEditTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          3,
          '1.1 Primera tarea',
          '1.9 Primera tarea renumerada',
          'persona',
        );
      });
    });

    it('eliminar una tarea exige confirmación y llama a pipelineRemoveTask tras confirmar', async () => {
      renderView();

      openTaskMenu(0);
      const deleteBtn = await screen.findByRole('button', { name: /^Eliminar tarea$/i });
      fireEvent.click(deleteBtn);

      expect(pipelineRemoveTask).not.toHaveBeenCalled();

      const confirmBtn = await screen.findByRole('button', { name: /^Eliminar$/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(pipelineRemoveTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          3,
          '1.1 Primera tarea',
          'persona',
        );
      });
      expect(onRefresh).toHaveBeenCalled();
    });

    it('cancelar la eliminación deja la tarea intacta', async () => {
      renderView();

      openTaskMenu(0);
      const deleteBtn = await screen.findByRole('button', { name: /^Eliminar tarea$/i });
      fireEvent.click(deleteBtn);

      const cancelBtn = await screen.findByRole('button', { name: /Cancelar/i });
      fireEvent.click(cancelBtn);

      expect(pipelineRemoveTask).not.toHaveBeenCalled();
    });

    it('muestra error de mismatch con opción de recargar tareas', async () => {
      pipelineAddTask.mockResolvedValueOnce({ success: false, error: 'mismatch' });
      renderView();

      fireEvent.click(screen.getByRole('button', { name: /Nueva tarea/i }));
      const input = screen.getByPlaceholderText(/Descripción de la nueva tarea/i);
      fireEvent.change(input, { target: { value: 'Tarea con choque' } });
      fireEvent.click(screen.getByRole('button', { name: /^Agregar$/i }));

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByText(/El archivo cambió en disco/i)).toBeTruthy();

      const reloadBtn = screen.getByRole('button', { name: /Recargar tareas/i });
      fireEvent.click(reloadBtn);
      expect(onRefresh).toHaveBeenCalled();
    });

    it('traduce los códigos de error conocidos (not-found, archived, not-a-task, empty-text, out-of-bounds)', async () => {
      pipelineEditTask.mockResolvedValueOnce({ success: false, error: 'archived' });
      renderView();

      const [editBtn] = screen.getAllByRole('button', { name: /^Editar tarea$/i });
      fireEvent.click(editBtn);
      fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByText(/El cambio está archivado/i)).toBeTruthy();
    });
  });

  // --- Bloque B: Concurrencia y unificación de estado ocupado ---
  describe('Unificación de estado ocupado y concurrencia (Bloque B)', () => {
    it('dos clics rápidos en confirmar eliminación generan una sola llamada IPC', async () => {
      let resolveIpc: (val: any) => void;
      pipelineRemoveTask.mockImplementationOnce(
        () => new Promise((resolve) => { resolveIpc = resolve; }),
      );

      renderView();

      openTaskMenu(0);
      const deleteBtn = await screen.findByRole('button', { name: /^Eliminar tarea$/i });
      fireEvent.click(deleteBtn);

      const confirmBtn = await screen.findByRole('button', { name: /^Eliminar$/i });
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn); // Segundo clic durante viaje

      expect(pipelineRemoveTask).toHaveBeenCalledTimes(1);

      resolveIpc!({ success: true });
    });
  });

  // --- Tarea 8.8 y Bloque C: Reordenar por menú, atajos de teclado y Drag & Drop con asa a la izquierda ---
  describe('Reordenamiento de tareas y controles de fila (Tarea 8.8 y Bloque C)', () => {
    it('mueve una tarea hacia abajo usando el menú de 3 puntos', async () => {
      renderView();

      openTaskMenu(0);
      const downBtn = await screen.findByRole('button', { name: /^Bajar tarea/i });
      fireEvent.click(downBtn);

      await waitFor(() => {
        expect(pipelineMoveTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          3,
          4,
          '1.1 Primera tarea',
          'persona',
        );
      });
      expect(onRefresh).toHaveBeenCalled();
    });

    it('mueve una tarea hacia arriba usando el menú de 3 puntos', async () => {
      renderView();

      openTaskMenu(1); // Tarea 1.2
      const upBtn = await screen.findByRole('button', { name: /^Subir tarea/i });
      fireEvent.click(upBtn);

      await waitFor(() => {
        expect(pipelineMoveTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          4,
          3,
          '1.2 Segunda tarea',
          'persona',
        );
      });
    });

    it('soporta reordenar directamente con atajos Alt+ArrowUp y Alt+ArrowDown en la fila', async () => {
      renderView();

      const taskList = screen.getByRole('list');

      // Tarea 1.1: Alt+ArrowDown
      const firstItem = taskList.querySelectorAll('li')[0];
      fireEvent.keyDown(firstItem, { key: 'ArrowDown', altKey: true });

      await waitFor(() => {
        expect(pipelineMoveTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          3,
          4,
          '1.1 Primera tarea',
          'persona',
        );
      });

      // Tarea 1.3: Alt+ArrowUp
      const lastItem = taskList.querySelectorAll('li')[2];
      fireEvent.keyDown(lastItem, { key: 'ArrowUp', altKey: true });

      await waitFor(() => {
        expect(pipelineMoveTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          5,
          3,
          '1.3 Tercera tarea',
          'persona',
        );
      });
    });

    it('renderiza el asa de arrastre a la izquierda en la primera columna', () => {
      renderView();

      const taskList = screen.getByRole('list');
      const firstItem = taskList.querySelectorAll('li')[0];
      const dragHandle = firstItem.querySelector('[aria-label="Arrastrar para reordenar"]');
      expect(dragHandle).toBeTruthy();
      expect(firstItem.firstElementChild).toBe(dragHandle);
    });

    it('soporta reordenar por Drag & Drop HTML5 sin layout shift', async () => {
      renderView();

      const taskList = screen.getByRole('list');
      const taskItems = taskList.querySelectorAll('li');
      const firstItem = taskItems[0];
      const secondItem = taskItems[1];

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn(() => '1.1'),
        effectAllowed: 'none',
        dropEffect: 'none',
      };
      fireEvent.dragStart(firstItem, { dataTransfer });
      expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '1.1');

      fireEvent.dragOver(secondItem, { dataTransfer });
      fireEvent.drop(secondItem, { dataTransfer });

      await waitFor(() => {
        expect(pipelineMoveTask).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          3,
          4,
          '1.1 Primera tarea',
          'persona',
        );
      });
    });

    it('revierte el orden optimista en caso de fallo al mover y muestra error', async () => {
      pipelineMoveTask.mockResolvedValueOnce({ success: false, error: 'mismatch' });
      renderView();

      openTaskMenu(0);
      const downBtn = await screen.findByRole('button', { name: /^Bajar tarea/i });
      fireEvent.click(downBtn);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy();
      });
      expect(screen.getByText(/El archivo cambió en disco/i)).toBeTruthy();
    });
  });

  // --- Tarea 8.2, Bloque D y Bloque G: Editor Crudo, Copiar y Vista Formateada ---
  describe('Editor crudo, botón copiar y vista formateada (Tareas 8.2, 8.12 D y G)', () => {
    it('permite cambiar a la vista de editor Markdown y guardar los cambios', async () => {
      renderView();

      const markdownTab = screen.getByRole('button', { name: /^Markdown$/i });
      fireEvent.click(markdownTab);

      // Conmutar a editor crudo usando el botón de editar
      const editBtn = screen.getByRole('button', { name: /Editar Markdown/i });
      fireEvent.click(editBtn);

      const textarea = screen.getByPlaceholderText(/## 1\. Grupo/i);
      expect(textarea).toBeTruthy();
      expect((textarea as HTMLTextAreaElement).value).toContain('Primera tarea');

      fireEvent.change(textarea, {
        target: { value: '## 1. Grupo\n\n- [ ] 1.1 Tarea modificada a mano' },
      });

      const saveBtn = screen.getByRole('button', { name: /Guardar archivo/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(pipelineWriteArtifact).toHaveBeenCalledWith(
          'C:/repo',
          'demo-change',
          'tasks',
          '## 1. Grupo\n\n- [ ] 1.1 Tarea modificada a mano',
          { overwrite: true, actor: 'persona' },
        );
      });
      expect(onRefresh).toHaveBeenCalled();
    });

    it('copia el contenido del Markdown al portapapeles y muestra indicador Copiado (Bloque D)', async () => {
      renderView();

      const markdownTab = screen.getByRole('button', { name: /^Markdown$/i });
      fireEvent.click(markdownTab);

      const copyBtn = screen.getByRole('button', { name: /Copiar Markdown/i });
      fireEvent.click(copyBtn);

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockChange.artifacts!.tasks);
      expect(await screen.findByRole('button', { name: /Copiado/i })).toBeTruthy();
    });

    it('permite cambiar a la vista con formato SafeMarkdown y persiste en localStorage (Bloque G y Ajuste 3)', () => {
      renderView();

      const markdownTab = screen.getByRole('button', { name: /^Markdown$/i });
      fireEvent.click(markdownTab);

      // SafeMarkdown renderiza el texto formateado
      expect(screen.getByText('1. Grupo')).toBeTruthy();
      expect(localStorage.getItem('gitcron:openspec:tasks-markdown-view-mode')).toBe('formatted');

      // Botón Editar Markdown dentro de la vista formateada conmuta a raw
      const editInRawBtn = screen.getByRole('button', { name: /Editar Markdown/i });
      fireEvent.click(editInRawBtn);

      expect(screen.getByPlaceholderText(/## 1\. Grupo/i)).toBeTruthy();
      expect(localStorage.getItem('gitcron:openspec:tasks-markdown-view-mode')).toBe('raw');
    });

    it('protege cambios sin guardar al intentar volver a la lista (guardar y cambiar)', async () => {
      renderView();

      fireEvent.click(screen.getByRole('button', { name: /^Markdown$/i }));
      fireEvent.click(screen.getByRole('button', { name: /Editar Markdown/i }));

      const textarea = screen.getByPlaceholderText(/## 1\. Grupo/i);
      fireEvent.change(textarea, { target: { value: 'Texto no guardado' } });

      fireEvent.click(screen.getByRole('button', { name: /Lista interactiva/i }));

      const saveAndSwitchBtn = await screen.findByRole('button', {
        name: /Guardar y cambiar/i,
      });
      expect(saveAndSwitchBtn).toBeTruthy();

      fireEvent.click(saveAndSwitchBtn);

      await waitFor(() => {
        expect(pipelineWriteArtifact).toHaveBeenCalled();
      });
    });

    it('protege cambios sin guardar al intentar volver a la lista (descartar cambios)', async () => {
      renderView();

      fireEvent.click(screen.getByRole('button', { name: /^Markdown$/i }));
      fireEvent.click(screen.getByRole('button', { name: /Editar Markdown/i }));

      const textarea = screen.getByPlaceholderText(/## 1\. Grupo/i);
      fireEvent.change(textarea, { target: { value: 'Texto para descartar' } });

      fireEvent.click(screen.getByRole('button', { name: /Lista interactiva/i }));

      const discardBtn = await screen.findByRole('button', {
        name: /Descartar cambios/i,
      });
      fireEvent.click(discardBtn);

      expect(pipelineWriteArtifact).not.toHaveBeenCalled();
      expect(screen.getByRole('list')).toBeTruthy();
    });
  });

  // --- Tarea 8.4: Detección de tareas mal formadas ---
  describe('Detección y señalamiento de tareas mal formadas (Tarea 8.4)', () => {
    it('señala tareas mal formadas en la vista de lista sin bloquear operaciones', async () => {
      const malformedChange: OpenSpecChangeEvidence = {
        ...mockChange,
        artifacts: {
          ...mockChange.artifacts!,
          tasks: [
            '## 1. Grupo',
            '- [ ] 1.1 Tarea ok',
            '- [] 1.2 Tarea rota corchetes vacíos',
            '-[ ] 1.3 Tarea rota guion pegado',
          ].join('\n'),
        },
      };

      renderView(malformedChange);

      const warning = await screen.findByRole('status');
      expect(warning).toBeTruthy();
      expect(screen.getByText(/Líneas de tarea mal formadas/i)).toBeTruthy();
      expect(screen.getByText(/- \[\] 1\.2 Tarea rota/)).toBeTruthy();
      expect(screen.getByText(/-\[ \] 1\.3 Tarea rota/)).toBeTruthy();

      const [checkBtn] = screen.getAllByRole('button', { name: /Marcar esta tarea/i });
      expect((checkBtn as HTMLButtonElement).disabled).toBe(false);
    });

    it('señala tareas mal formadas en la vista de texto sin bloquear el guardado', async () => {
      const malformedChange: OpenSpecChangeEvidence = {
        ...mockChange,
        artifacts: {
          ...mockChange.artifacts!,
          tasks: '## 1. Grupo\n- [] 1.1 Tarea rota',
        },
      };

      renderView(malformedChange);

      fireEvent.click(screen.getByRole('button', { name: /^Markdown$/i }));
      fireEvent.click(screen.getByRole('button', { name: /Editar Markdown/i }));

      expect(await screen.findByRole('status')).toBeTruthy();
      expect(screen.getByText(/Líneas de tarea mal formadas/i)).toBeTruthy();

      const textarea = screen.getByPlaceholderText(/## 1\. Grupo/i);
      fireEvent.change(textarea, { target: { value: '## 1. Grupo\n- [] 1.1 Tarea rota editada' } });
      const saveBtn = screen.getByRole('button', { name: /Guardar archivo/i });
      expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // --- Preparar commit: acciones empujadas a la derecha (Observación visual 2026-09-09) ---
  describe('Preparar commit: .prepareActions empujada a la derecha', () => {
    it('.prepareActions tiene margin-left: auto para alinear acciones en el borde derecho del contenedor flex', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/sdd/SddPrepareCommit.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      const actionsMatch = css.match(/\.prepareActions\s*\{([^}]+)\}/);
      expect(actionsMatch).toBeTruthy();
      expect(actionsMatch![1]).toMatch(/margin-left:\s*auto/);
    });
  });

  // --- Observación 8.17: Ajustes visuales de tareas (Bloques A, B, C) ---
  describe('Observación 8.17: Ajustes visuales de tareas (Bloques A, B, C)', () => {
    it('Bloque A: el recuadro visible del hover de la casilla (.taskStatus) mide 1.75rem y coincide con .iconBtn', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      // Objetivo de clic accesible conservado en 2.75rem
      const statusMatch = css.match(/\.taskStatus\s*\{([^}]+)\}/);
      expect(statusMatch).toBeTruthy();
      expect(statusMatch![1]).toMatch(/min-width:\s*2\.75rem/);
      expect(statusMatch![1]).toMatch(/min-height:\s*2\.75rem/);

      // Recuadro visible de hover en ::before con 1.75rem y radio var(--radius-md)
      const beforeMatch = css.match(/\.taskStatus::before\s*\{([^}]+)\}/);
      expect(beforeMatch).toBeTruthy();
      expect(beforeMatch![1]).toMatch(/width:\s*1\.75rem/);
      expect(beforeMatch![1]).toMatch(/height:\s*1\.75rem/);
      expect(beforeMatch![1]).toMatch(/border-radius:\s*var\(--radius-md\)/);

      // Color de hover idéntico a .iconBtn
      const hoverBeforeMatch = css.match(/\.taskStatus:hover:not\(:disabled\)::before\s*\{([^}]+)\}/);
      expect(hoverBeforeMatch).toBeTruthy();
      expect(hoverBeforeMatch![1]).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--color-border-subtle\)\s+50%,\s*transparent\)/);

      // Ícono alineado ópticamente con la primera línea de texto
      const svgMatch = css.match(/\.taskStatus\s+svg\s*\{([^}]+)\}/);
      expect(svgMatch).toBeTruthy();
      expect(svgMatch![1]).toMatch(/margin-top:\s*calc\(\(1\.5\s*\*\s*var\(--font-size-xs\)\s*-\s*1rem\)\s*\/\s*2\)/);
    });

    it('Bloque B: la canaleta de arrastre de 2rem se desplaza al margen izquierdo mediante ensanchamiento de la fila', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      const liMatch = css.match(/\.taskList\s*>\s*li\s*\{([^}]+)\}/);
      expect(liMatch).toBeTruthy();
      expect(liMatch![1]).toMatch(/grid-template-columns:\s*2rem\s+2\.75rem\s+3rem/);
      expect(liMatch![1]).toMatch(/margin-left:\s*(?:-1\.5rem|calc\(-1\s*\*\s*var\(--space-5\)\))/);
      expect(liMatch![1]).toMatch(/width:\s*calc\(100%\s*\+\s*(?:1\.5rem|var\(--space-5\)\))/);
    });

    it('Bloque C: la fila resalta al pasar el puntero y convive armónicamente con data-current', () => {
      const modulePath = path.resolve(process.cwd(), 'components/pipeline/OpenSpecDashboard.module.css');
      const css = fs.readFileSync(modulePath, 'utf-8');

      // Resalte hover en .taskList > li
      const hoverMatch = css.match(/\.taskList\s*>\s*li:hover\s*\{([^}]+)\}/);
      expect(hoverMatch).toBeTruthy();
      expect(hoverMatch![1]).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--color-bg-overlay\)\s+85%,\s*var\(--color-text-primary\)\)/);

      // Convivencia con la fila actual data-current
      const currentMatch = css.match(/\.taskList\s*>\s*li\[data-current='true'\]\s*\{([^}]+)\}/);
      expect(currentMatch).toBeTruthy();
      expect(currentMatch![1]).toMatch(/border-left:\s*3px\s+solid\s+var\(--color-primary\)/);

      const currentHoverMatch = css.match(/\.taskList\s*>\s*li\[data-current='true'\]:hover\s*\{([^}]+)\}/);
      expect(currentHoverMatch).toBeTruthy();
      expect(currentHoverMatch![1]).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--color-bg-overlay\)\s+75%,\s*var\(--color-text-primary\)\)/);
    });

    it('cuando artifacts es null pero hay tareas, la vista markdown no queda vacía y reconstruye desde tasks', () => {
      const changeWithoutArtifacts: OpenSpecChangeEvidence = {
        ...mockChange,
        artifacts: null,
      };
      renderView(changeWithoutArtifacts);

      // Cambiar a vista Markdown
      fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));

      // Cambiar a modo crudo para inspeccionar el valor del textarea
      const editRawBtn = screen.getByRole('button', { name: /Editar Markdown|pipeline\.openspec\.task\.editInRaw/i });
      fireEvent.click(editRawBtn);

      const textarea = screen.getByRole('textbox', { name: /Editor Markdown|pipeline\.openspec\.task\.viewRaw/i }) as HTMLTextAreaElement;
      expect(textarea.value).toContain('- [ ] 1.1 Primera tarea');
      expect(textarea.value).toContain('- [x] 1.2 Segunda tarea');
    });

    it('cuando artifacts es null y gitReadFile está disponible, rescata el tasks.md exacto de disco', async () => {
      const changeWithoutArtifacts: OpenSpecChangeEvidence = {
        ...mockChange,
        artifacts: null,
      };
      const exactDiskContent = '## 1. Cierre\n\n- [ ] 1.1 Tarea leida de disco\n';
      const gitReadFile = vi.fn().mockResolvedValue({ success: true, data: exactDiskContent });
      (window as any).api.gitReadFile = gitReadFile;

      renderView(changeWithoutArtifacts);

      await waitFor(() => {
        expect(gitReadFile).toHaveBeenCalledWith('C:/repo', 'openspec/changes/demo-change/tasks.md');
      });

      // Cambiar a vista Markdown
      fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));

      // Cambiar a modo crudo para inspeccionar el valor del textarea
      const editRawBtn = screen.getByRole('button', { name: /Editar Markdown|pipeline\.openspec\.task\.editInRaw/i });
      fireEvent.click(editRawBtn);

      const textarea = screen.getByRole('textbox', { name: /Editor Markdown|pipeline\.openspec\.task\.viewRaw/i }) as HTMLTextAreaElement;
      expect(textarea.value).toBe(exactDiskContent);
    });
  });
});
