const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '../data/tasks.json');

const readTasks = () => {
  try {
    const data = fs.readFileSync(dataPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

const writeTasks = (tasks) => {
  fs.writeFileSync(dataPath, JSON.stringify(tasks, null, 2));
};

exports.getTasks = (req, res) => {
  try {
    const tasks = readTasks();
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};

exports.createTask = (req, res) => {
  try {
    const { text, completed = false } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({ error: 'Task text is required' });
    }

    const tasks = readTasks();
    const newTask = {
      id: uuidv4(),
      text: text.trim(),
      completed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    tasks.push(newTask);
    writeTasks(tasks);

    res.status(201).json(newTask);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
};

exports.updateTask = (req, res) => {
  try {
    const { id } = req.params;
    const { text, completed } = req.body;

    // Validate that at least one field is being updated
    if (text === undefined && completed === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Validate text if provided
    if (text !== undefined && text.trim() === '') {
      return res.status(400).json({ error: 'Task text cannot be empty' });
    }

    const tasks = readTasks();
    const taskIndex = tasks.findIndex(task => task.id === id);

    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update only the provided fields
    if (text !== undefined) {
      tasks[taskIndex].text = text.trim();
    }
    if (completed !== undefined) {
      tasks[taskIndex].completed = completed;
    }
    
    tasks[taskIndex].updatedAt = new Date().toISOString();
    
    writeTasks(tasks);

    res.json(tasks[taskIndex]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update task' });
  }
};

exports.deleteTask = (req, res) => {
  try {
    const { id } = req.params;

    const tasks = readTasks();
    const taskIndex = tasks.findIndex(task => task.id === id);

    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    tasks.splice(taskIndex, 1);
    writeTasks(tasks);

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
};