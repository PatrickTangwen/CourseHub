# Static Catalog JSON vs GraphQL

最后更新：2026-06-19

## 1. 这份文档的用途

这份文档不是产品计划，也不是 PRD。

它的用途是：在后续面试、项目介绍、设计评审、PRD 拆解时，用来回答下面这类 implementation 问题：

- 为什么 catalog 主路径不用实时 GraphQL？
- 静态 catalog JSON 和 GraphQL 的区别是什么？
- 你们为什么先做 snapshot，而不是直接查数据库？
- 这样做的性能、复杂度、数据一致性 tradeoff 是什么？
- 什么时候该用静态快照，什么时候该用 GraphQL？

## 2. 一句话版本

对这个项目来说，`catalog search` 是一个高频筛选、排序、搜索的公开只读路径，最适合用 `static catalog JSON snapshot`；而 `GraphQL` 更适合用户态数据、细粒度查询、权限控制和后续登录功能。

更准确地说，这里的“实时 GraphQL”其实不是“直接实时连学校官网”，而是“按请求查询当前数据库状态”。如果底层 UCSD 数据本来就是 nightly import，那么 GraphQL 也只是比静态 snapshot 更新得更快一些，但仍然不是 WebReg 级别的实时数据。

## 3. 两者的定义

### Static Catalog JSON

后端在数据管线完成后，按 term 生成一份静态课程快照文件，例如：

- `catalog/public/{term}.json`
- `catalog/metadata.json`

前端加载这份快照后，在浏览器本地完成：

- 全文搜索
- filter
- sort
- 课程列表渲染
- 课程详情基础字段展示
- anonymous worksheet 的冲突检测

这是一种“先整包下载，再本地查询”的模式。

### GraphQL

前端每次需要数据时，再向后端发 query，由后端按字段和条件返回结果。

这是一种“每次现问服务器，要什么拿什么”的模式。

在 CourseTable 现有架构里，GraphQL 主要通过 Hasura 暴露数据库查询能力。

## 4. 核心区别

| 维度             | Static Catalog JSON              | GraphQL              |
| ---------------- | -------------------------------- | -------------------- |
| 数据获取方式     | 预生成快照                       | 按请求查询           |
| 典型交互         | 本地 filter/sort/search          | 每次交互打后端       |
| 网络依赖         | 首次加载依赖网络，后续交互弱依赖 | 每次查询都依赖网络   |
| 更新延迟         | 取决于 snapshot 生成频率         | 取决于数据库更新时间 |
| 查询灵活性       | 低，字段结构需预先设计           | 高，按需请求字段     |
| catalog 搜索性能 | 很适合高频筛选                   | 容易产生大量查询     |
| 实现复杂度       | 前端简单，数据准备要求高         | 后端查询层更复杂     |
| 权限控制         | 不适合敏感细粒度数据             | 适合权限和角色控制   |

## 5. 为什么 catalog 主路径更适合静态 JSON

这个项目的 `catalog` 不是一个低频详情页，而是一个高频交互面：

- 用户会频繁改筛选条件
- 会在多个字段上排序
- 会连续输入关键词搜索
- 会反复切换 subject、time、units、GPA、GE filters

如果这些动作都走 GraphQL，系统会出现几个问题：

1. 每次筛选变化都可能触发请求，前后端耦合更深。
2. catalog 会变成“查询驱动 UI”，而不是“数据驱动 UI”。
3. 实现和调试成本更高，尤其是在 filter 组合很多时。
4. 后端和数据库会承受大量交互型请求。
5. 前端体验更依赖网络状态和服务端响应时间。

而静态 JSON 的优势正好匹配 catalog：

1. 课程数据先下载一次，后续交互基本都在本地完成。
2. 本地 filter/sort 响应快，用户体验更稳定。
3. 前端逻辑可预测，容易复用 CourseTable 现有模式。
4. 后端只需要负责生成 snapshot，不必承担 catalog 的每次筛选请求。

## 6. 为什么这不等于“实时数据”

一个常见误区是把 GraphQL 理解成“实时”，把静态 JSON 理解成“离线”。

这在你的项目里不准确。

UCSD 的底层数据来源本身就是：

- Schedule of Classes：nightly updated
- GPA CSV：周期性导入
- GE mapping：手动或半自动维护

所以无论是 GraphQL 还是静态 JSON，它们依赖的都是你自己的数据库状态，而不是学校系统的实时在线状态。

更准确的说法应该是：

- `Static JSON`：前端读的是某个时间点生成的课程快照
- `GraphQL`：前端读的是当前数据库中的课程状态

如果数据库每天夜里更新一次，那么 GraphQL 也只是“更接近最新导入结果”，而不是“真实世界实时状态”。

## 7. 这个项目里的推荐读取契约

MVP-1 推荐定义一个明确的数据契约：`Catalog Snapshot`

每个 term 一份 snapshot，再加一份 metadata。

建议这个 snapshot 至少包含：

- 课程基础信息：subject、course number、title、units
- catalog 信息：description、prerequisites、restrictions
- section 信息：section id、meeting type、days、time、building、room、instructor
- seat 信息：seats available、seat limit、last updated
- GPA 信息：average GPA、sample size、grade distribution、historical GPA
- GE 信息：college GE badges

这样前端以下功能都可以只依赖 snapshot：

- catalog 搜索
- filter/sort
- course detail 的基础内容
- anonymous worksheet
- conflict detection
- shareable worksheet URL

这样做的好处是，你可以把系统清楚地拆成两层：

1. 数据生产层：crawler/import/normalization/snapshot generation
2. 产品消费层：frontend catalog/worksheet

## 8. GraphQL 什么时候更合适

GraphQL 仍然有价值，只是不是 MVP-1 catalog 主路径的核心依赖。

它更适合下面这些场景：

- 登录后用户数据
- saved worksheets
- wishlist
- saved searches
- profile/privacy settings
- 权限控制字段
- 后续 professor/course detail 的细粒度补充查询
- 需要按需取字段、避免整包下载的页面

如果未来你做：

- 用户登录
- server-side persistence
- 私有数据
- 多角色访问
- 更复杂的 mutation

那 GraphQL 或者其他按请求查询接口就会变得更重要。

## 9. 这套设计的 tradeoff

### 你获得了什么

- catalog 体验更快
- 前端实现更简单
- 更符合 CourseTable 现有架构
- 更容易把 crawler 和 frontend 解耦
- 更容易定义清晰的验收边界

### 你付出了什么

- snapshot 不是实时数据
- 首次加载体积可能较大
- 需要提前设计字段结构
- 生成 snapshot 的数据管线必须可靠
- 当字段需求变化时，需要重新生成数据产物

## 10. 面试时推荐的回答方式

### 问题：为什么不用实时 GraphQL？

推荐回答：

> 因为我们这个产品里，catalog 是一个高频 filter/sort/search 的公开只读路径。
> 如果每次用户改筛选条件都打 GraphQL，请求数量和前后端耦合都会明显上升。
> 所以我把 catalog 定义成一个按 term 生成的 `Catalog Snapshot`，前端一次加载后在本地完成大部分交互。
> 这样更适合 CourseTable 这类课程目录产品。GraphQL 则保留给登录后用户数据和更细粒度查询。

### 问题：那 GraphQL 还有什么价值？

推荐回答：

> GraphQL 更适合用户态、私有态和按需查询的数据，比如 saved worksheets、wishlist、profile、后续权限控制字段。
> 也就是说，我不是不用 GraphQL，而是把它放在更合适的路径上，而不是让它承担 catalog 的所有交互压力。

### 问题：静态 snapshot 会不会过期？

推荐回答：

> 会，所以它必须被当作“课程快照”而不是“实时教务系统镜像”。
> 但在这个项目里，底层 UCSD Schedule of Classes 本身也是 nightly updated，所以就算走 GraphQL，也不是 WebReg 级实时数据。
> 我会在 UI 里明确显示 `last updated`，把数据时效性说清楚，而不是误导用户。

### 问题：为什么这是一种合理的工程 tradeoff？

推荐回答：

> 因为它把系统边界切得更清楚。
> 数据层负责抓取、清洗、归一化、生成 snapshot；产品层负责消费 snapshot 做搜索和排课。
> 这样 MVP 阶段能优先解决真正高风险的问题，比如 schedule crawler、GPA matching、Yale feature cleanup，而不是一开始就把 GraphQL schema 和交互查询做复杂。

## 11. 面试时不要说错的点

- 不要把 GraphQL 直接说成“实时数据”
- 不要把静态 JSON 说成“完全离线”
- 不要说“静态 JSON 更先进”或“GraphQL 更先进”
- 不要把这个选择描述成教条式架构偏好

更准确的说法是：

- 这是一个按产品交互模式做出的数据读取契约选择
- catalog 和 user-state 的访问模式不同，所以不该强行共用一条读取路径
- GraphQL 和 snapshot 不是互斥关系，而是职责分层

## 12. 适合写进 PRD/Spec 的简化版本

可以直接复用下面这段：

> MVP-1 的 catalog 主路径采用 `Catalog Snapshot` 读取契约。
> 后端在每次课程数据导入完成后，按 term 生成静态 catalog JSON 和 metadata，前端基于这些 snapshot 完成 catalog 搜索、筛选、排序、课程详情基础展示和 anonymous worksheet 冲突检测。
> GraphQL/按请求查询接口不作为 MVP-1 catalog 的用户路径依赖，而保留给后续登录态用户数据、私有数据和细粒度查询场景。
