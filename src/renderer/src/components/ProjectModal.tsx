import { useState } from 'react'
import type { ProjectInput } from '../../../shared/types'
import { PROJECT_COLORS } from '../constants'
import { Icon } from './Icon'
import { Modal, errText, toast } from './ui'

export function ProjectModal({
  initial,
  onClose,
  onSaved
}: {
  initial: ProjectInput
  onClose: () => void
  onSaved: (id: number) => void
}) {
  const [f, setF] = useState(initial)

  const save = async () => {
    if (!f.name.trim()) return toast('请填写项目名称', 'err')
    try {
      const id = await window.api.saveProject(f)
      toast(f.id ? '项目已更新' : '项目已创建')
      onSaved(id)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  return (
    <Modal
      title={f.id ? '编辑项目' : '新建项目'}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field full">
          <span>项目名称 *</span>
          <input
            autoFocus
            value={f.name}
            placeholder="例如：商城 App、运营后台"
            onChange={(e) => setF({ ...f, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        <div className="field full">
          <span>标识颜色</span>
          <div className="swatches">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${f.color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setF({ ...f, color: c })}
                title={c}
              >
                {f.color === c && <Icon name="tick" size={12} />}
              </button>
            ))}
          </div>
        </div>
        <label className="field full">
          <span>说明</span>
          <textarea
            rows={3}
            value={f.description}
            placeholder="项目简介、仓库位置、负责人等（可选）"
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </label>
      </div>
    </Modal>
  )
}
