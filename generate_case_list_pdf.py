#!/usr/bin/env python3
"""
Case List PDF Generator
Generates a clean, formatted PDF report of all current cases
"""

import json
import os
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT


def load_cases():
    """Load cases from the JSON file"""
    try:
        with open('data/cases.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('cases', [])
    except Exception as e:
        print(f"Error loading cases: {e}")
        return []


def get_attention_display(attention, top_priority):
    """Convert attention status to display text"""
    status_parts = []
    
    if top_priority:
        status_parts.append("TOP PRIORITY")
    
    if attention == "needs_attention":
        status_parts.append("Needs Attention")
    elif attention == "waiting":
        status_parts.append("Waiting")
    elif attention == "":
        status_parts.append("Clear")
    else:
        status_parts.append(attention.replace("_", " ").title())
    
    return " | ".join(status_parts) if status_parts else "Clear"


def create_pdf_report():
    """Generate the PDF report"""
    cases = load_cases()
    
    if not cases:
        print("No cases found to generate report.")
        return
    
    # Filter out archived cases
    active_cases = [case for case in cases if not case.get('archived', False)]
    
    # Create filename with timestamp
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"Current_Case_List_{timestamp}.pdf"
    
    # Create PDF document
    doc = SimpleDocTemplate(filename, pagesize=letter,
                           rightMargin=0.75*inch, leftMargin=0.75*inch,
                           topMargin=1*inch, bottomMargin=0.75*inch)
    
    # Define styles
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=30,
        alignment=TA_CENTER,
        textColor=colors.black
    )
    
    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontSize=12,
        spaceAfter=20,
        alignment=TA_CENTER,
        textColor=colors.grey
    )
    
    # Build document content
    story = []
    
    # Title
    title = Paragraph("Current Case List", title_style)
    story.append(title)
    
    # Date
    current_date = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    subtitle = Paragraph(f"Generated on {current_date}", subtitle_style)
    story.append(subtitle)
    
    story.append(Spacer(1, 20))
    
    # Create table data
    table_data = []
    
    # Header row
    headers = [
        "Client Name",
        "Case Name/Number", 
        "Type",
        "Stage",
        "Status",
        "Current Focus"
    ]
    table_data.append(headers)
    
    # Sort cases by priority (top priority first), then by attention status, then by client name
    def sort_key(case):
        priority = 0 if case.get('top_priority', False) else 1
        attention_order = {
            'needs_attention': 0,
            'waiting': 1,
            '': 2
        }
        attention = attention_order.get(case.get('attention', ''), 3)
        client_name = case.get('client_name', '').lower()
        return (priority, attention, client_name)
    
    active_cases.sort(key=sort_key)
    
    # Define cell styles for wrapping text
    cell_style = ParagraphStyle(
        'CellText',
        parent=styles['Normal'],
        fontSize=8,
        leading=10,
        leftIndent=0,
        rightIndent=0,
        spaceAfter=0,
        wordWrap='LTR'
    )
    
    header_style = ParagraphStyle(
        'HeaderText',
        parent=styles['Normal'],
        fontSize=10,
        leading=12,
        fontName='Helvetica-Bold',
        textColor=colors.whitesmoke,
        leftIndent=0,
        rightIndent=0,
        spaceAfter=0,
        wordWrap='LTR'
    )
    
    # Add case data
    for case in active_cases:
        client_name = case.get('client_name', 'N/A')
        
        # Case name and number
        case_name = case.get('case_name', 'N/A')
        case_number = case.get('case_number', '')
        if case_number:
            case_display = f"{case_name}<br/>({case_number})"
        else:
            case_display = case_name
        
        case_type = case.get('case_type', 'N/A')
        stage = case.get('stage', 'N/A')
        
        # Status with attention and priority
        status_display = get_attention_display(
            case.get('attention', ''), 
            case.get('top_priority', False)
        )
        
        current_focus = case.get('current_focus', 'N/A')
        # Remove the truncation since we'll let it wrap naturally
        
        # Create Paragraph objects for text wrapping
        row_data = [
            Paragraph(client_name, cell_style),
            Paragraph(case_display, cell_style),
            Paragraph(case_type, cell_style),
            Paragraph(stage, cell_style),
            Paragraph(status_display, cell_style),
            Paragraph(current_focus, cell_style)
        ]
        
        table_data.append(row_data)
    
    # Wrap headers in Paragraph objects too
    wrapped_headers = [Paragraph(header, header_style) for header in headers]
    table_data[0] = wrapped_headers
    
    # Create table with adjusted column widths to better accommodate wrapped text
    table = Table(table_data, colWidths=[1.2*inch, 1.4*inch, 0.9*inch, 0.7*inch, 1.1*inch, 1.8*inch])
    
    # Style the table
    table_style = TableStyle([
        # Header styling
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        
        # Data row styling
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.beige, colors.white]),
        
        # Cell padding and borders
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        
        # Borders
        ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
        
        # Valign
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ])
    
    # Add special highlighting for top priority cases
    for i, case in enumerate(active_cases, start=1):
        if case.get('top_priority', False):
            # Highlight top priority cases with light red background
            table_style.add('BACKGROUND', (0, i), (-1, i), colors.lightpink)
        elif case.get('attention') == 'needs_attention':
            # Highlight needs attention cases with light yellow background
            table_style.add('BACKGROUND', (0, i), (-1, i), colors.lightyellow)
    
    table.setStyle(table_style)
    story.append(table)
    
    # Add summary at bottom
    story.append(Spacer(1, 30))
    
    summary_style = ParagraphStyle(
        'Summary',
        parent=styles['Normal'],
        fontSize=10,
        alignment=TA_LEFT,
        textColor=colors.grey
    )
    
    total_cases = len(active_cases)
    top_priority_count = len([c for c in active_cases if c.get('top_priority', False)])
    needs_attention_count = len([c for c in active_cases if c.get('attention') == 'needs_attention'])
    waiting_count = len([c for c in active_cases if c.get('attention') == 'waiting'])
    
    summary_text = f"""
    <b>Summary:</b><br/>
    Total Active Cases: {total_cases}<br/>
    Top Priority: {top_priority_count}<br/>
    Needs Attention: {needs_attention_count}<br/>
    Waiting: {waiting_count}<br/>
    <br/>
    <i>Note: Top priority cases are highlighted in light red, cases needing attention are highlighted in light yellow.</i>
    """
    
    summary = Paragraph(summary_text, summary_style)
    story.append(summary)
    
    # Build PDF
    doc.build(story)
    
    print(f"PDF report generated successfully: {filename}")
    print(f"Total cases included: {total_cases}")
    
    # Try to open the PDF
    try:
        os.startfile(filename)  # Windows
    except AttributeError:
        try:
            os.system(f'open "{filename}"')  # macOS
        except:
            os.system(f'xdg-open "{filename}"')  # Linux


if __name__ == "__main__":
    create_pdf_report()