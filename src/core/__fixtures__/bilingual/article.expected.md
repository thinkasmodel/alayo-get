---
id: "01K7B2Q8N4M6P3R5T7V9X1Z3A5"
source: "https://example.org/blog/small-library-catalogs"
medium: "web"
title: "How Small Libraries Keep Their Catalogs Alive"
author: "Maya Lindqvist"
published: "2026-09-30T00:00:00.000Z"
captured: "2026-10-18T05:40:00.000Z"
site: "example.org"
tags: []
note: ""
extract: "full"
lang: "en"
translated_to: "zh"
translation: "complete"
---

# How Small Libraries Keep Their Catalogs Alive

# 小型图书馆如何使他们的目录保持活力

[原文](https://example.org/blog/small-library-catalogs)

Most small libraries still run on a catalog that was built twenty years ago. It works, but every change takes a volunteer, a spreadsheet, and an afternoon.

大多数小型图书馆仍在二十年前建立的目录上运行。它有效，但每一次改变都需要一个志愿者、一个电子表格和一个下午。

## What we changed

## 我们改变了什么

We moved the catalog into plain text files and kept them in a [Git repository](https://git-scm.com/). Each book is **one file**, and a nightly job runs `catalog build` to regenerate the website.

我们将目录移动到纯文本文件中，并将它们保存在 Git 存储库中。每本书都是一个文件，每晚的工作都会运行 `catalog build` 来重新生成网站。

-   Volunteers edit files in any text editor.\
    志愿者在任何文本编辑器中编辑文件。
-   Every change is reviewed before it goes live.\
    每个更改在上线之前都会进行审查。
    -   Reviews take a day at most.\
        审查最多需要一天。
-   Old versions are never lost.\
    旧版本永远不会丢失。
    
    Git keeps every one.

    Git 保留每一个。
    

1.  Export the old catalog to CSV.\
    将旧目录导出到 CSV。
2.  Convert each row into a Markdown file.\
    将每一行转换为一个降价文件。

> The best catalog is the one people are willing to update.
>
> 最好的目录是人们愿意更新的人。

```bash
catalog build --out site/
```

![Reading room at the Eastside branch](.assets/01K7B2Q8N4M6P3R5T7V9X1Z3A5/img-1.jpg)

Branch

分支

Books

图书

Eastside

东区

12,400

* * *

The whole migration took three weekends.  
Nobody had to learn a new tool. Use \* and \_ carefully, 2. is not a list.

整个迁移花了三个周末。\
没有人必须学习一个新工具。小心使用 \* 和 \_，2. 不是列表。
