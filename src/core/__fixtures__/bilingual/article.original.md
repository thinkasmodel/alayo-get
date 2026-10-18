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
---

# How Small Libraries Keep Their Catalogs Alive

[原文](https://example.org/blog/small-library-catalogs)

Most small libraries still run on a catalog that was built twenty years ago. It works, but every change takes a volunteer, a spreadsheet, and an afternoon.

## What we changed

We moved the catalog into plain text files and kept them in a [Git repository](https://git-scm.com/). Each book is **one file**, and a nightly job runs `catalog build` to regenerate the website.

-   Volunteers edit files in any text editor.
-   Every change is reviewed before it goes live.
    -   Reviews take a day at most.
-   Old versions are never lost.
    
    Git keeps every one.
    

1.  Export the old catalog to CSV.
2.  Convert each row into a Markdown file.

> The best catalog is the one people are willing to update.

```bash
catalog build --out site/
```

![Reading room at the Eastside branch](.assets/01K7B2Q8N4M6P3R5T7V9X1Z3A5/img-1.jpg)

Branch

Books

Eastside

12,400

* * *

The whole migration took three weekends.  
Nobody had to learn a new tool. Use \* and \_ carefully, 2. is not a list.
