# Spaceify

Spaceify turns Spotify Extended Streaming History into an interactive star chart. Explore your albums and artists by listening time or genre, see how your listening changed year by year, and zoom into an album to see its tracks as satellites.

The hosted app opens with the owner’s published map. To see your own, choose **History** and select the extracted `Streaming_History_Audio_*.json` files from your Spotify export. Your import stays in your browser and clears on reload.

## Listening Map in context

```mermaid
C4Context
  title Listening Map system context
  Person(owner, "Site owner", "Prepares and approves the default chart")
  Person(visitor, "Visitor", "Explores the chart or opens their own history")
  System(map, "Listening Map", "Builds and displays album and artist maps")
  System_Ext(blob, "Vercel Blob", "Holds the approved public chart input")
  System_Ext(catalog, "Music catalog providers", "Supply optional metadata, artwork and suggestions")

  Rel(owner, map, "Reviews the chart")
  Rel(visitor, map, "Explores the sky")
  Rel(map, blob, "Reads chart", "HTTPS")
  Rel(map, catalog, "Looks up metadata and loads art", "HTTPS")

  UpdateRelStyle(owner, map, $offsetX="-110", $offsetY="-8")
  UpdateRelStyle(visitor, map, $offsetX="35", $offsetY="2")
  UpdateRelStyle(map, blob, $offsetX="-31", $offsetY="-29")
  UpdateRelStyle(map, catalog, $offsetX="10", $offsetY="-6")
  UpdateElementStyle(blob, $fontColor="#172033", $bgColor="#e2e8f0", $borderColor="#64748b")
  UpdateElementStyle(catalog, $fontColor="#172033", $bgColor="#e2e8f0", $borderColor="#64748b")
  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

## Where the code runs

```mermaid
C4Container
  title Listening Map applications and storage
  Person(owner, "Site owner", "Runs preparation and approves the public chart")
  Person(visitor, "Visitor", "Browses the sky and selects local files")

  System_Boundary(map, "Listening Map") {
    Container(prep, "Owner preparation", "Node.js and TypeScript", "Writes a review draft and public candidate")
    Container(site, "Static site", "Vite build on Vercel", "Serves the frontend and owner chart JSON")
    Container(browser, "Browser app", "React, Canvas and Web Worker", "Draws charts and holds visitor data in memory")
  }

  Rel(owner, prep, "Runs preparation", "Local files")
  Rel(visitor, browser, "Opens local files", "File picker")
  Rel(browser, site, "Loads chart", "HTTPS")

  UpdateRelStyle(owner, prep, $offsetX="-105", $offsetY="-34")
  UpdateRelStyle(visitor, browser, $offsetX="10", $offsetY="-30")
  UpdateRelStyle(browser, site, $offsetX="-32", $offsetY="-31")
  UpdateElementStyle(prep, $fontColor="#ffffff", $bgColor="#245f97", $borderColor="#17466f")
  UpdateElementStyle(site, $fontColor="#ffffff", $bgColor="#245f97", $borderColor="#17466f")
  UpdateElementStyle(browser, $fontColor="#ffffff", $bgColor="#245f97", $borderColor="#17466f")
  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## How the owner chart reaches Vercel

```mermaid
C4Deployment
  title Listening Map Vercel release and site load
  Deployment_Node(local, "Owner computer", "Local environment") {
    Container(prep, "Preparation tools", "Node.js", "Write the review draft and public candidate")
  }
  Deployment_Node(vercel, "Vercel", "Production deployment") {
    ContainerDb(blob, "Public Blob store", "Vercel Blob", "Hosts the owner-approved candidate")
    Container(build, "Site build", "Vite and Node.js", "Validates and stages the approved JSON")
    Container(site, "Published site", "Static hosting", "Serves the app and owner-chart.json")
  }
  Deployment_Node(device, "Visitor device", "Web browser") {
    Container(browser, "Listening Map", "React and Canvas", "Opens the owner chart on startup")
  }

  Rel(prep, blob, "Manual upload")
  Rel(build, blob, "Fetches candidate", "HTTPS")
  Rel(build, site, "Stages app and chart", "dist directory")
  Rel(browser, site, "Loads app and chart", "Same-origin HTTPS")

  UpdateRelStyle(prep, blob, $offsetX="-45", $offsetY="-22")
  UpdateRelStyle(build, blob, $offsetX="9", $offsetY="-9")
  UpdateRelStyle(build, site, $offsetX="9", $offsetY="-9")
  UpdateRelStyle(browser, site, $offsetX="12", $offsetY="-10")
  UpdateElementStyle(prep, $fontColor="#ffffff", $bgColor="#245f97", $borderColor="#17466f")
  UpdateElementStyle(blob, $fontColor="#172033", $bgColor="#e2e8f0", $borderColor="#64748b")
  UpdateElementStyle(build, $fontColor="#ffffff", $bgColor="#245f97", $borderColor="#17466f")
  UpdateElementStyle(site, $fontColor="#ffffff", $bgColor="#245f97", $borderColor="#17466f")
  UpdateElementStyle(browser, $fontColor="#ffffff", $bgColor="#245f97", $borderColor="#17466f")
```

## What happens when a visitor imports history

```mermaid
sequenceDiagram
  actor Visitor
  box Browser app
    participant Dialog as History dialog
    participant Worker as Import worker
    participant Chart as Sky chart
  end
  Visitor->>Dialog: Select extracted audio JSON files
  Dialog->>Worker: Pass selected files
  Worker->>Worker: Validate, deduplicate and total by UTC year
  alt Import succeeds
    Worker-->>Dialog: Return listening history
    Dialog->>Chart: Show the visitor archive
  else Import fails
    Worker-->>Dialog: Return a readable error
    Dialog-->>Visitor: Show the import error
  end
```

## How the app draws the sky

```mermaid
C4Component
  title From listening archive to sky chart
  Container_Boundary(browser, "Browser app") {
    Component(archive, "Archive adapters", "TypeScript", "Return the graph for a year and view")
    Component(controls, "Chart state", "React", "Holds the year, view, layout and current selection")
    Component(explore, "Graph filtering", "TypeScript", "Chooses the Focus set and direct links")
    Component(index, "Index and Details", "React and HTML", "Lists and inspects the same nodes by keyboard")
    Component(canvas, "Sky renderer", "HTML Canvas 2D", "Draws stars, images, links and satellites")
    Component(layout, "Layout rules", "TypeScript", "Assign coordinates in Hours or Genre")
  }

  Rel(controls, archive, "Requests graph")
  Rel(controls, explore, "Filters graph")
  Rel(controls, canvas, "Passes active graph")
  Rel(controls, index, "Passes browsable nodes")
  Rel(canvas, layout, "Sets positions")

  UpdateRelStyle(controls, archive, $offsetX="-45", $offsetY="-13")
  UpdateRelStyle(controls, explore, $offsetX="-36", $offsetY="-13")
  UpdateRelStyle(controls, canvas, $offsetX="12", $offsetY="0")
  UpdateRelStyle(controls, index, $offsetX="-87", $offsetY="-22")
  UpdateRelStyle(canvas, layout, $offsetX="-40", $offsetY="-13")
  UpdateElementStyle(archive, $fontColor="#172033", $bgColor="#dbeafe", $borderColor="#245f97")
  UpdateElementStyle(controls, $fontColor="#172033", $bgColor="#dbeafe", $borderColor="#245f97")
  UpdateElementStyle(explore, $fontColor="#172033", $bgColor="#dbeafe", $borderColor="#245f97")
  UpdateElementStyle(index, $fontColor="#172033", $bgColor="#dbeafe", $borderColor="#245f97")
  UpdateElementStyle(canvas, $fontColor="#172033", $bgColor="#dbeafe", $borderColor="#245f97")
  UpdateElementStyle(layout, $fontColor="#172033", $bgColor="#dbeafe", $borderColor="#245f97")
  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## Run locally

Use Node.js 22.13+ on the 22.x line or Node.js 24+. Run the commands below and open the local URL Vite prints.

```sh
npm ci
npm run dev
```

[Architecture walkthrough](docs/ARCHITECTURE.md) · [Maintainer guide](docs/MAINTAINER_GUIDE.md)
