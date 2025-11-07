# Caseboard - Legal Case Management System

A comprehensive case management system with multiple interfaces for different use cases.

## Interfaces

### Three Main UIs:
1. **`/manage`** — Full CRUD interface for case management, focus logging, deadlines, and detailed case operations
2. **`/tv`** — Passive display board for conference rooms with auto-scroll and live updates
3. **`/board`** — Interactive colleague board for case selection, focus history, and task collaboration

## Quick Start
```bash
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

### Access Points:
- **Manage Interface**: http://127.0.0.1:8000/manage
- **TV Display**: http://127.0.0.1:8000/tv  
- **Colleague Board**: http://127.0.0.1:8000/board
- **API Documentation**: http://127.0.0.1:8000/docs

## Features

### Case Management
- **UUID-based primary keys** with optional case numbers
- **Focus logging** with timestamps and author tracking
- **Deadline management** with automatic next-due calculation
- **Colleague task assignments** with review tracking
- **Priority flagging** and attention states
- **Archive functionality** for completed cases
- **CSV import/export** capabilities

### Colleague Collaboration
- **Interactive case board** with sidebar details
- **Focus history tracking** (last 5 entries displayed)
- **Colleague task system** with author initials (WB, NC, TG, CS, SJ)
- **Task review workflow** with timestamps
- **Real-time case selection** and visual feedback

### Display & TV Mode
- **Responsive design** with fluid typography
- **Auto-scroll functionality** with adaptive speed
- **Live status indicators** and real-time updates
- **Priority highlighting** and attention markers
- **Viewport-optimized layouts**

## API Endpoints

### Core Case Operations
- `GET /api/cases` - List all cases with schema
- `POST /api/cases` - Create new case
- `GET /api/cases/{id}` - Get specific case
- `PUT /api/cases/{id}` - Update case
- `DELETE /api/cases/{id}` - Delete case

### Focus & Task Management
- `POST /api/cases/{id}/focus` - Add focus entry
- `POST /api/cases/{id}/deadlines` - Update deadlines
- `POST /api/cases/{id}/colleague-tasks` - Add colleague task
- `POST /api/cases/{id}/colleague-tasks/{task_id}/review` - Mark task as reviewed

### Display & Reporting
- `GET /tv/cases` - TV-optimized case list with colleague task flags
- `GET /api/cases/{id}/details` - Full case details for sidebar
- `GET /api/reports/clients.pdf` - Generate client case summary PDF

## Configuration

### Branding
- Replace `static/pngs/McMathWoods_Logo_White.png` with your logo
- Edit CSS design tokens in `static/styles.css :root` section
- Customize colors, fonts, and spacing via CSS variables

### Environment
- Uses FastAPI with automatic API documentation
- Background scheduling for cache refresh (90-second intervals)
- SQLite-like JSON file storage in `data/cases.json`
- Automatic backup system in `data/backups/`

## Data Model

### Case Structure
- **Basic Info**: client_name, case_name, case_type, case_number
- **Status Tracking**: stage, status, attention, paralegal
- **Court Details**: county, division, judge, opposing_counsel
- **Medical/Claims**: ICD-10 codes, providers, claim_summary
- **Workflow**: focus_log, deadlines, colleague_tasks
- **Flags**: top_priority, archived

### Focus Entries
- **Timestamp**: ISO format with timezone
- **Author**: User initials or identifier  
- **Text**: Focus description/update

### Colleague Tasks
- **UUID**: Unique task identifier
- **Author**: Colleague initials (WB, NC, TG, CS, SJ)
- **Task**: Description text
- **Review Status**: Boolean with optional review timestamp

## Technical Notes
- **Primary keys**: UUID v4 for database-agnostic compatibility
- **Date handling**: ISO 8601 format with automatic parsing
- **Responsive breakpoints**: 600px, 900px, 1200px for different layouts
- **Cache busting**: Automatic versioning for static assets
- **Error handling**: Graceful degradation with offline indicators

## Development
The system uses modern web standards with progressive enhancement:
- **Backend**: FastAPI (Python) with Pydantic validation
- **Frontend**: Vanilla JavaScript with CSS Grid/Flexbox
- **Styling**: CSS custom properties with fluid typography
- **Data**: JSON file storage with atomic writes and backups
