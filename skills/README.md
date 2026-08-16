# CourseHub Skills 文档

CourseHub 启动时会从 `ECHOMIND_SKILLS_DIR` 读取 Skills，并在匹配用户请求时注入到对应 Agent 的 system prompt。Skills 适合维护回答规范、答案安全约束、转介规则和禁止事项。

当前内置三类 Skills：

```text
skills/general_reception/SKILL.md  # 接待分流：双语接待、需求澄清、能力边界、个案转介
skills/course_facts/SKILL.md       # 课程事实：客观信息应答与五条回答安全约束
skills/course_planning/SKILL.md    # 规划建议：有依据的倾向性建议与免责声明
```

## Skill 文件格式

推荐每个 Skill 使用独立目录，并将主文件命名为 `SKILL.md`：

```text
skills/<skill_name>/SKILL.md
```

文件顶部使用简单 front matter：

```markdown
---
name: 课程事实规范
description: 适用于 Course Agent 的课程客观信息应答规范
keywords: 先修,学分,名额,教授,GPA,schedule,prerequisite
agents: course
enabled: true
---
```

字段说明：

- `name`：Skill 展示名称，会出现在注入给模型的 prompt 中。
- `description`：简短说明，方便 `/skills` 接口排查。
- `keywords`：触发关键词，用户消息命中后才注入；多个关键词用英文逗号或中文逗号分隔均可。
- `agents`：适用 Agent，可填 `general`、`course`、`planning`，多个值用逗号分隔。
- `enabled`：是否启用，支持 `true/false`。

## 编写要求

- 重要规则放在文档前半部分，因为过长内容会按 prompt 预算截断。
- 一类 Skill 只描述一类职责，不要把事实应答、规划建议、接待分流的规则混在一个文件里。
- 必须包含"角色定位""禁止事项""示例表达"等稳定章节。
- 回答安全约束（名额带快照时间戳、不合成课程 GPA、缺描述不编造、数据缺口如实声明、回答标注学期）写在课程事实规范中，措辞变更需同步评测用例。
- 对无法保证的事项使用保守措辞，例如"在现有记录中""数据未覆盖"。
- 个案事务（hold、petition、waiver、申诉）的转介渠道要写明确。

## 热加载

修改 Skill 文件后，不需要重启服务，调用：

```bash
curl -X POST http://localhost:8000/skills/reload
```

查看加载结果和解析错误：

```bash
curl http://localhost:8000/skills
```
