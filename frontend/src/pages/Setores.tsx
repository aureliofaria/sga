import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sectorsApi, usersApi } from '../services/api';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import type { Sector, SectorMember } from '../types';

type Level = 'LIDER_1' | 'LIDER_2' | 'MEMBRO';
const LEVELS: { value: Level; label: string; badge: string; dot: string }[] = [
  { value: 'LIDER_1', label: 'Líder I', badge: 'bg-golplus-blue-100 text-golplus-blue-800', dot: 'bg-golplus-blue' },
  { value: 'LIDER_2', label: 'Líder II', badge: 'bg-golplus-blue-50 text-golplus-blue-700', dot: 'bg-golplus-blue-400' },
  { value: 'MEMBRO', label: 'Membro', badge: 'bg-golplus-orange-100 text-golplus-orange-700', dot: 'bg-golplus-orange' },
];
const levelMeta = (l: string) => LEVELS.find((x) => x.value === l) ?? LEVELS[2];

function MemberBadge({ member, supervisors, onRemove, onChangeLevel, onChangeReportsTo }: {
  member: SectorMember;
  supervisors: SectorMember[]; // possíveis "reporta a" (Líder I/II do setor, exceto ele)
  onRemove: () => void;
  onChangeLevel: (level: Level) => void;
  onChangeReportsTo: (reportsToId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = levelMeta(member.level);
  const isMemberOrL2 = member.level === 'MEMBRO' || member.level === 'LIDER_2';
  const supName = supervisors.find((s) => s.id === member.reportsToId)?.user.name;
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="w-8 h-8 rounded-full bg-golplus-blue-100 flex items-center justify-center text-golplus-blue-700 font-bold text-sm">
        {member.user.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{member.user.name}</div>
        <div className="text-xs text-gray-400 truncate">
          {member.user.email}{isMemberOrL2 && supName ? ` · reporta a ${supName}` : ''}
        </div>
      </div>
      <div className="relative">
        <button onClick={() => setOpen(!open)} className={`px-2 py-1 rounded-lg text-xs font-medium ${meta.badge} cursor-pointer`}>
          {meta.label} ▾
        </button>
        {open && (
          <div className="absolute right-0 top-7 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-48">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">Nível</div>
            {LEVELS.map((lv) => (
              <button
                key={lv.value}
                onClick={() => { onChangeLevel(lv.value); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${member.level === lv.value ? 'font-bold' : ''}`}
              >
                {lv.label}
              </button>
            ))}
            {isMemberOrL2 && (
              <>
                <hr className="my-1" />
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">Reporta a</div>
                <select
                  value={member.reportsToId ?? ''}
                  onChange={(e) => { onChangeReportsTo(e.target.value || null); setOpen(false); }}
                  className="mx-2 my-1 w-[calc(100%-1rem)] px-2 py-1 border border-gray-200 rounded-lg text-xs"
                >
                  <option value="">— (direto ao Líder I)</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>{levelMeta(s.level).label}: {s.user.name}</option>
                  ))}
                </select>
              </>
            )}
            <hr className="my-1" />
            <button onClick={() => { onRemove(); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">
              Remover do setor
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SectorCard({ sector }: { sector: Sector }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sector.name);
  const [description, setDescription] = useState(sector.description || '');
  const [adding, setAdding] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newLevel, setNewLevel] = useState<Level>('MEMBRO');
  const [newReportsTo, setNewReportsTo] = useState('');
  const qc = useQueryClient();

  const { data: available } = useQuery({
    queryKey: ['sector-available', sector.id],
    queryFn: () => sectorsApi.availableUsers(sector.id),
    enabled: adding,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['sectors'] });
    qc.invalidateQueries({ queryKey: ['sector-available', sector.id] });
  };

  const updateMut = useMutation({
    mutationFn: () => sectorsApi.update(sector.id, { name, description }),
    onSuccess: () => { toast.success('Setor atualizado'); setEditing(false); qc.invalidateQueries({ queryKey: ['sectors'] }); },
    onError: () => toast.error('Erro ao atualizar setor'),
  });

  const toggleMut = useMutation({
    mutationFn: () => sectorsApi.update(sector.id, { isActive: !sector.isActive }),
    onSuccess: () => { toast.success(sector.isActive ? 'Setor desativado' : 'Setor ativado'); qc.invalidateQueries({ queryKey: ['sectors'] }); },
  });

  const deleteMut = useMutation({
    mutationFn: () => sectorsApi.delete(sector.id),
    onSuccess: () => { toast.success('Setor removido'); qc.invalidateQueries({ queryKey: ['sectors'] }); },
    onError: () => toast.error('Erro ao remover setor'),
  });

  const addMemberMut = useMutation({
    mutationFn: () => sectorsApi.addMember(sector.id, {
      userId: selectedUserId,
      level: newLevel,
      reportsToId: newLevel === 'LIDER_1' ? null : (newReportsTo || null),
    }),
    onSuccess: () => {
      toast.success('Membro adicionado');
      setAdding(false); setSelectedUserId(''); setNewLevel('MEMBRO'); setNewReportsTo('');
      invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Erro ao adicionar membro'),
  });

  const removeMemberMut = useMutation({
    mutationFn: (memberId: string) => sectorsApi.removeMember(sector.id, memberId),
    onSuccess: () => { toast.success('Membro removido'); invalidate(); },
  });

  const changeLevelMut = useMutation({
    mutationFn: ({ memberId, level }: { memberId: string; level: Level }) =>
      sectorsApi.updateMember(sector.id, memberId, { level }),
    onSuccess: () => { toast.success('Nível atualizado'); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Erro ao atualizar nível'),
  });

  const changeReportsMut = useMutation({
    mutationFn: ({ memberId, reportsToId }: { memberId: string; reportsToId: string | null }) =>
      sectorsApi.updateMember(sector.id, memberId, { reportsToId }),
    onSuccess: () => { toast.success('"Reporta a" atualizado'); invalidate(); },
    onError: () => toast.error('Erro ao atualizar'),
  });

  const lider1 = sector.members.filter((m) => m.level === 'LIDER_1');
  const lider2 = sector.members.filter((m) => m.level === 'LIDER_2');
  const membros = sector.members.filter((m) => m.level === 'MEMBRO');
  // Possíveis "reporta a": Líder I e Líderes II do setor.
  const supervisors = [...lider1, ...lider2];

  const renderGroup = (list: SectorMember[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {list.map((m) => (
        <MemberBadge
          key={m.id}
          member={m}
          supervisors={supervisors.filter((s) => s.id !== m.id)}
          onRemove={() => removeMemberMut.mutate(m.id)}
          onChangeLevel={(level) => changeLevelMut.mutate({ memberId: m.id, level })}
          onChangeReportsTo={(reportsToId) => changeReportsMut.mutate({ memberId: m.id, reportsToId })}
        />
      ))}
    </div>
  );

  return (
    <div className={`bg-white rounded-2xl border shadow-sm transition-all ${sector.isActive ? 'border-gray-200' : 'border-dashed border-gray-300 opacity-70'}`}>
      {/* Header */}
      <div className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-xl bg-golplus-blue-100 flex items-center justify-center text-golplus-blue-700 font-bold text-lg">
          {sector.name.charAt(0).toUpperCase()}
        </div>

        {editing ? (
          <div className="flex-1 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-golplus-blue rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição..."
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none"
            />
            <button onClick={() => updateMut.mutate()} className="px-3 py-1.5 bg-golplus-blue text-white rounded-lg text-sm">Salvar</button>
            <button onClick={() => { setEditing(false); setName(sector.name); setDescription(sector.description || ''); }} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">✕</button>
          </div>
        ) : (
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">{sector.name}</span>
              {!sector.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inativo</span>}
            </div>
            {sector.description && <div className="text-xs text-gray-400 mt-0.5">{sector.description}</div>}
          </div>
        )}

        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1" title="Líder I">
            <span className="w-2 h-2 bg-golplus-blue rounded-full" />{lider1.length} L-I
          </span>
          <span className="flex items-center gap-1" title="Líder II">
            <span className="w-2 h-2 bg-golplus-blue-400 rounded-full" />{lider2.length} L-II
          </span>
          <span className="flex items-center gap-1" title="Membros">
            <span className="w-2 h-2 bg-golplus-orange rounded-full" />{membros.length} memb.
          </span>
        </div>

        <div className="flex items-center gap-1">
          {!editing && (
            <button onClick={() => setEditing(true)} className="p-1.5 text-gray-400 hover:text-golplus-blue rounded-lg hover:bg-golplus-blue-50" title="Editar">
              ✏️
            </button>
          )}
          <button onClick={() => toggleMut.mutate()} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50" title={sector.isActive ? 'Desativar' : 'Ativar'}>
            {sector.isActive ? '🔒' : '🔓'}
          </button>
          <button
            onClick={() => { if (window.confirm(`Remover setor "${sector.name}"?`)) deleteMut.mutate(); }}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
            title="Excluir"
          >
            🗑️
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50">
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100 p-5 space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Hierarquia: <b>Líder I</b> (1 por setor, vê todo o setor) · <b>Líder II</b> (vê seus reportes) · <b>Membro</b> (vê os próprios).
            </p>
            <button
              onClick={() => setAdding((v) => !v)}
              className="text-xs text-golplus-blue hover:text-golplus-blue-700 font-medium"
            >
              {adding ? '✕ Cancelar' : '+ Adicionar pessoa'}
            </button>
          </div>

          {adding && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Usuário</label>
                <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">Selecionar...</option>
                  {(available || []).map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Nível</label>
                <select value={newLevel} onChange={(e) => setNewLevel(e.target.value as Level)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  {LEVELS.map((lv) => <option key={lv.value} value={lv.value}>{lv.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-1">Reporta a</label>
                <select
                  value={newReportsTo}
                  onChange={(e) => setNewReportsTo(e.target.value)}
                  disabled={newLevel === 'LIDER_1'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">— (Líder I)</option>
                  {supervisors.map((s) => <option key={s.id} value={s.id}>{levelMeta(s.level).label}: {s.user.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-4 flex justify-end">
                <button
                  onClick={() => { if (selectedUserId) addMemberMut.mutate(); }}
                  disabled={!selectedUserId || addMemberMut.isPending}
                  className="px-4 py-2 bg-golplus-blue text-white rounded-lg text-sm disabled:opacity-40"
                >
                  {addMemberMut.isPending ? 'Adicionando...' : 'Adicionar ao setor'}
                </button>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-golplus-blue flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-golplus-blue rounded-full" /> Líder I
            </h3>
            {lider1.length === 0 ? <p className="text-xs text-gray-400 italic">Nenhum Líder I — defina um para o setor ser visível pela liderança.</p> : renderGroup(lider1)}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-golplus-blue flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-golplus-blue-400 rounded-full" /> Líder II
            </h3>
            {lider2.length === 0 ? <p className="text-xs text-gray-400 italic">Nenhum Líder II.</p> : renderGroup(lider2)}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-golplus-orange flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-golplus-orange rounded-full" /> Membros
            </h3>
            {membros.length === 0 ? <p className="text-xs text-gray-400 italic">Nenhum membro.</p> : renderGroup(membros)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Setores() {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [search, setSearch] = useState('');
  const qc = useQueryClient();

  const { data: sectors = [], isLoading } = useQuery({
    queryKey: ['sectors'],
    queryFn: sectorsApi.getAll,
  });

  const createMut = useMutation({
    mutationFn: () => sectorsApi.create({ name: newName.trim(), description: newDescription }),
    onSuccess: () => {
      toast.success('Setor criado com sucesso!');
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      qc.invalidateQueries({ queryKey: ['sectors'] });
    },
    onError: () => toast.error('Erro ao criar setor'),
  });

  const filtered = sectors.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(search.toLowerCase())
  );
  const active = filtered.filter((s) => s.isActive);
  const inactive = filtered.filter((s) => !s.isActive);

  return (
    <div>
      <Header
        title="Setores"
        subtitle="Gerencie os setores e a hierarquia (Líder I / Líder II / Membros) da Gol Plus"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Buscar setor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
        />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-4 py-2 bg-golplus-blue text-white rounded-xl text-sm font-medium hover:bg-golplus-blue-700 transition-colors"
        >
          {showCreate ? '✕ Cancelar' : '+ Novo Setor'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-2xl border border-golplus-blue-200 p-5 mb-6 shadow-sm">
          <h3 className="text-sm font-semibold text-golplus-blue mb-4">Novo Setor</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex: Comercial, Financeiro, Sinistros..."
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(); }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Descrição</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Descrição opcional..."
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-golplus-blue-300"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowCreate(false); setNewName(''); setNewDescription(''); }} className="px-4 py-2 border border-gray-200 rounded-xl text-sm">Cancelar</button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!newName.trim() || createMut.isPending}
              className="px-5 py-2 bg-golplus-blue text-white rounded-xl text-sm font-medium disabled:opacity-40"
            >
              {createMut.isPending ? 'Criando...' : 'Criar Setor'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total de Setores', value: sectors.length, color: 'bg-golplus-blue-50 text-golplus-blue-700' },
          { label: 'Ativos', value: sectors.filter((s) => s.isActive).length, color: 'bg-green-50 text-green-700' },
          { label: 'Total de Membros', value: sectors.reduce((acc, s) => acc + s.members.length, 0), color: 'bg-golplus-orange-50 text-golplus-orange-700' },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-2xl p-4 ${stat.color}`}>
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-xs font-medium mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {isLoading && (
        <div className="text-center py-12 text-gray-400">Carregando setores...</div>
      )}

      {!isLoading && sectors.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-gray-500 font-medium mb-1">Nenhum setor criado</div>
          <div className="text-gray-400 text-sm">Clique em "Novo Setor" para começar.</div>
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-3 mb-6">
          {active.map((sector) => <SectorCard key={sector.id} sector={sector} />)}
        </div>
      )}

      {inactive.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Setores inativos</h3>
          <div className="space-y-3">
            {inactive.map((sector) => <SectorCard key={sector.id} sector={sector} />)}
          </div>
        </div>
      )}
    </div>
  );
}
