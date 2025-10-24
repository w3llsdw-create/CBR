cd "/c/Users/DavidWells/Caseboard_Portable"
cd /c/Users/David\ Wells/Caseboard_Portable
cd "/c/Users/David Wells/Caseboard_Portable"
cat > .gitignore << 'EOF'
# Editors
.vscode/
*.code-workspace

# Windows noise
Thumbs.db
Desktop.ini

# Node/JS
node_modules/
dist/
build/

# Python
.venv/
venv/
__pycache__/
*.py[cod]

# .NET / C/C++
bin/
obj/
*.user
*.suo
*.vcxproj.user

# Logs and env
*.log
.env*
coverage/
EOF

git init
git config user.name "David Wells"
git config user.email "dwilliamwells@gmail.com"
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/w3llsdw-create/Caseboard_Portable.git
git push -u origin main
git pull origin main --allow-unrelated-histories
git push -u origin main

git merge --abort
git remote remove origin
git remote add origin https://github.com/w3llsdw-create/Caseboard_Portable.git
git push -u origin main
cd "/c/Users/David Wells/Caseboard_Portable"
cat > .gitignore << 'EOF'
# Editors
.vscode/
*.code-workspace

# Windows noise
Thumbs.db
Desktop.ini

# Node/JS
node_modules/
dist/
build/

# Python
.venv/
venv/
__pycache__/
*.py[cod]

# .NET / C/C++
bin/
obj/
*.user
*.suo
*.vcxproj.user

# Logs and env
*.log
.env*
coverage/
EOF

git init
git config user.name "David Wells"
git config user.email "dwilliamwells@gmail.com"
git add -A
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/w3llsdw-create/Caseboard_Portable.git
git push -u origin main
