# Case List PDF Generator

This tool generates a clean, formatted PDF report of all current cases from your case management system.

## Files Created

1. **Generate_Case_List_PDF.bat** - Windows Batch file (double-click to run)
2. **Generate_Case_List_PDF.ps1** - PowerShell script (alternative method)
3. **generate_case_list_pdf.py** - Python script that does the actual PDF generation

## How to Use

### Easy Method (Recommended)
Simply **double-click** on `Generate_Case_List_PDF.bat` and the PDF will be generated automatically.

### PowerShell Method
If you prefer PowerShell, right-click on `Generate_Case_List_PDF.ps1` and select "Run with PowerShell".

## What the PDF Contains

- **Title**: "Current Case List" with current date and time
- **Case Information**: 
  - Client Name
  - Case Name and Number (if available)
  - Case Type
  - Stage
  - Status (including priority and attention flags)
  - Current Focus
- **Formatting**: 
  - Clean, professional layout designed for printing
  - Color coding: Top Priority cases (light red), Needs Attention cases (light yellow)
  - Summary statistics at the bottom
- **Sorting**: Cases are sorted by priority (top priority first), then attention status, then client name

## Features

- Excludes archived cases
- Automatically opens the generated PDF
- Unique filename with timestamp (so multiple PDFs don't overwrite each other)
- Professional formatting suitable for printing or sharing
- Summary statistics showing total cases and counts by status

## Requirements

- Python virtual environment (automatically detected)
- reportlab package (automatically installed if needed)
- Internet connection (for package installation only)

## Output

The PDF file will be saved in the same folder with a name like:
`Current_Case_List_2025-11-05_162838.pdf`

The file will automatically open after generation so you can review, print, or save it elsewhere.