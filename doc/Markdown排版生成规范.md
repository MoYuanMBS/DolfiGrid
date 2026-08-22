# Markdown 固定排版生成规范

本文档是本项目 Markdown → 固定尺寸 HTML 排版图片的输入规范。

## 1. 项目原则

- Markdown 只负责内容、层级和绑定 ID。
- HTML 模板只负责固定结构和排版位置。
- CSS 只负责颜色、字体、尺寸、间距和视觉样式。
- JS 负责解析 Markdown、校验格式并生成新的 HTML。
- 生成结果不是响应式网页，而是固定画布图片排版。
- JS 不直接修改原始模板，只读取模板并输出新文件。

## 2. Frontmatter

文档可以使用 YAML 风格的 frontmatter：

```md
---
template: "susu_tactical_ui_template"
theme: "bright"
subtitle: "TACTICAL SERVICE MENU & PRICE LIST"
hud_tag: "TACTICAL SERVICE MENU // 战术导引菜单"
label.experience_badge_1: "OPTION A"
label.experience_badge_2: "OPTION B"
label.guarantee_badge: "GUARANTEED"
label.match_badge: "PER MATCH"
notice:
  - "消费前请老板务必查看点单须知。"
---
```

规则：

- 正文中没有一级文档标题时，删除对应标题元素。
- `template` 指向 `标准格式/<template>.html`，只写文件名主体，不写路径或扩展名。
- `theme` 指向 `css/themes/<theme>.css`，只写文件名主体，不写路径或扩展名。
- `subtitle`、`hud_tag` 和 `label.*` 是可变模板文字。
- 主标题不能写在 frontmatter，必须写在 Markdown 正文中。
- `label.*` 用于绑定可变装饰文字。
- 没有提供的装饰文字使用模板默认值，或按模板规则隐藏。
- `notice` 是须知列表。
- 最终解释权不放入 Markdown，必须由 HTML 模板固定提供。

## 3. 标题等级与 HTML 模板映射

标题等级只表示 Markdown 文档中的层级关系，不直接规定 HTML 使用 `h1`、`h2` 还是某个固定组件。

Markdown 允许使用 1 到 6 级标题：

```md
# [document:header] 文档级标题
## [section:experience] 体验套餐
### [card:exp-1] 机密体验单
#### 套餐说明
##### 价格规则
###### 补充说明
```

不要在 JS 中写死下面这种全局规则：

```text
## 永远是 section
### 永远是 card
```

因为不同 HTML 模板可能有不同的排版层级。标题应该由 HTML 模板声明如何接收 Markdown 数据。

### 3.1 HTML 模板绑定属性

HTML 模板使用 `data-md-*` 属性声明 Markdown 对应关系：

```html
<section
    data-section="experience"
    data-md-role="section"
    data-md-id="experience"
    data-md-heading-level="2"
>
    <h2 data-md-field="title"></h2>

    <div
        data-card-id="exp-1"
        data-md-role="card"
        data-md-id="exp-1"
        data-md-heading-level="3"
    >
        <h3 data-md-field="title"></h3>
        <div data-md-field="items"></div>
    </div>
</section>
```

属性含义：

- `data-md-role`：模板节点接收的内容角色，例如 `document`、`section`、`card`、`subheading`。
- `data-md-id`：对应 Markdown 中的绑定 ID。
- `data-md-heading-level`：该模板节点默认接收的 Markdown 标题等级。
- `data-md-field`：节点接收的字段，例如 `title`、`items`、`label`、`media`。
- `data-section`、`data-card-id`：保留作为现有布局和 CSS 的功能属性。

### 3.2 默认顺序绑定

HTML 模板中同一角色的可绑定元素，按照 DOM 出现顺序排列：

```html
<div data-md-role="card"></div>
<div data-md-role="card"></div>
<div data-md-role="card"></div>
```

Markdown 不写 ID 时，按照同一角色在文档中的出现顺序绑定：

```md
### 机密体验单
### 绝密体验单
### 特别体验单
```

对应关系为：

```text
第一个标题 → 第一个 card
第二个标题 → 第二个 card
第三个标题 → 第三个 card
```

默认顺序绑定是主要规则，适合大多数固定排版文档。

### 3.3 ID 显式覆盖

需要跳过顺序、指定特殊位置或跨模板定位时，才使用 ID：

```md
### [card:exp-2] 绝密体验单
```

ID 绑定优先于顺序绑定。被 ID 指定的模板元素标记为已使用，后续无 ID 内容继续从当前位置顺序绑定。

同一份 Markdown 可以用于不同 HTML 模板：

```text
模板 A：section 使用 ##，card 使用 ###
模板 B：section 使用 ###，card 使用 ####
```

只要两个模板声明了对应的角色和绑定顺序，或提供了对应的 `data-md-id`，JS 就不需要修改 Markdown 解析逻辑。

### 3.3 Markdown 标题写法

需要绑定模板的标题使用角色和 ID：

```md
# [document:header] 战术电竞服务价格表
## [section:escort] 护航
### [card:escort-guarantee] 保底
### [card:escort-match] 单局
```

不需要绑定具体模板的标题可以只写普通 Markdown 标题：

```md
#### 套餐说明
##### 价格规则
```

这类标题由模板根据 `data-md-role="subheading"` 或同级内容容器决定如何渲染。

如果 Markdown 标题等级与模板声明不一致：

- 有明确 `id` 时，以 ID 绑定为准，并记录等级不一致警告；
- 没有明确 `id` 时，按角色和顺序绑定；
- 角色也无法匹配时，生成器必须报错，不能猜测绑定目标。

ID 规则：

- ID 只能使用英文小写、数字、短横线和下划线。
- 同一种 ID 在全文中不能重复。
- HTML 模板通过 `data-md-role`、`data-md-id` 和 DOM 顺序查找对应位置。
- JS 不允许把 `D1`、`D2`、`D3` 写死为唯一业务结构。

### 3.4 跳过模板元素

使用独占一行的 `{{skip}}` 跳过当前位置对应的一个模板元素：

```md
### 机密体验单

{{skip}}

### 特别体验单
```

如果模板有三个连续的 `card` 元素，生成关系为：

```text
第一个 card → 机密体验单
第二个 card → 被删除
第三个 card → 特别体验单
```

`{{skip}}` 的规则：

- 必须独占一行。
- 跳过当前角色的一个模板元素。
- 被跳过的元素直接从生成结果中删除。
- 不保留高度、边距或透明占位空间。
- 不允许写在普通句子或列表内容中。
- `{{skip}}` 不等同于 `{{placeholder}}`。

## 4. 列表和强制换行

普通列表项：

```md
- 普通的一行文字
```

多行列表项：

```md
- 78r = 666w
  包通道卡 / 每人限一单
  每人仅限购买一次
```

规则：

- 以 `- ` 开头的是新的列表项。
- 紧随其后的、至少缩进两个空格的文字是该列表项的续行。
- 续行必须强制换行。
- 续行不依赖空格数量实现视觉对齐。
- 生成 HTML 时，续行文字必须和第一行文字的起始位置对齐。

## 5. 左右栏分隔符

使用 `/|` 表示左右栏分隔：

```md
- 158r /| 保底 788w
- 268r /| 保底 1488w
```

生成后：

```text
158r                         保底 788w
```

规则：

- `/|` 是特殊分隔符。
- 普通单独出现的 `|` 不具有分栏作用。
- `/|` 左侧生成 `.price-left`。
- `/|` 右侧生成 `.price-right`。
- 没有 `/|` 的列表项按普通多行内容处理。
- 分栏项目也可以继续写缩进续行：

```md
- 128r /| 保单局 688w
  打不到保底一直吃
```

## 6. 空字段和占位符

普通空字段：

```text
没有内容 → 删除对应元素
```

占位符只允许使用以下两种格式：

```md
{{placeholder}}
```

表示保留一行透明空间。

```md
{{placeholder lines=3}}
```

表示保留三行透明空间。

占位符规则：

- 占位符永远不输出任何文字。
- 占位符的输出值始终为空字符串。
- 占位符必须透明，但必须保留空间。
- `lines` 必须是正整数。
- 不支持 `{{placeholder:name}}`。
- 不支持其他占位符写法。
- 占位符文字不参与字体等级判断。
- 占位符所在结构的字体和行高由 HTML/CSS 模板决定。

示例：

```md
## [section:experience] 体验套餐

{{placeholder lines=3}}
```

这不会输出 `placeholder` 文字，只会保留三行透明区域。

## 7. 图片

图片由 frontmatter 的 `images` 按顺序提供：

```md
images:
  - "体验-机密.png"
  - "体验-绝密.png"
```

图片文件必须位于：

```text
assets/insert-png/
```

图片规则：

- 图片按原始比例缩放。
- 图片宽度不能超过所在容器。
- 高度根据宽高比自动计算。
- 不裁切、不变形。
- 图片框高度跟随实际图片高度。
- 第 1 张图片绑定到第 1 个未跳过的媒体槽位；后续图片依次绑定。
- 图片少于媒体槽位时，剩余图片框保持空白。
- 图片多于媒体槽位时，生成器必须报错。
- `{{skip}}` 删除的元素不消耗图片。
- 图片不存在时，生成器必须报错，不能生成损坏图片链接。

## 8. 构建命令

构建入口只接受 `original-md-files` 文件夹中的 Markdown 文件名：

```powershell
node .\new-project\build.js 体验护航.md
```

它会读取 frontmatter 的 `template`、`theme` 和 `images`，输出到：

```text
output/体验护航.html
```

## 9. 禁止内容

HTML 模板和生成结果中禁止出现以下可见占位文本：

```text
[ 须知事项 01 ]
[ 体验套餐 01 详细描述文本 / 占位符 ]
[ 保底条款说明 01 ]
体验卡片 01
```

这些文字不能作为默认内容留在最终图片中。

允许保留的是没有文字的结构占位符，例如：

```html
<div data-placeholder="art-copy"></div>
```

## 10. 固定模板内容

最终解释权必须由模板固定提供：

```html
<section class="copyright-section" data-section="copyright">
    <span class="copyright-text">
        *以上内容最终解释权归溯流电竞所有
    </span>
</section>
```

JS 不得因为 Markdown 缺少字段而删除、清空或替换该区域。

## 11. 生成前校验

JS 生成前必须检查：

- Markdown 是否可以读取。
- frontmatter 是否闭合。
- 标题等级是否在 1 到 6 之间。
- `section ID` 是否重复。
- `card ID` 是否重复。
- `data-md-id` 是否与 Markdown 绑定 ID 对应。
- `data-md-role` 是否是模板声明的有效角色。
- `data-md-heading-level` 是否为 1 到 6 的整数。
- 无 ID 标题是否能通过模板声明的等级和角色唯一绑定。
- `{{skip}}` 是否独占一行。
- `{{skip}}` 是否有可跳过的同角色模板元素。
- `/|` 是否拥有左右两侧内容。
- `lines` 是否为正整数。
- 图片文件是否存在。
- 最终 HTML 是否残留可见占位文本。
- 最终解释权区域是否仍然存在。
