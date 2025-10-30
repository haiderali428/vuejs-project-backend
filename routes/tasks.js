const express = require('express')
const router = express.Router()
const taskController = require('../controllers/taskController')

// GET /api/tasks - Get all tasks
router.get('/', taskController.getTasks)

// POST /api/tasks - Create a new task
router.post('/', taskController.createTask)

// PUT /api/tasks/:id - Update a task
router.put('/:id', taskController.updateTask)

// DELETE /api/tasks/:id - Delete a task
router.delete('/:id', taskController.deleteTask)

module.exports = router