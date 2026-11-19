import { Router } from 'express';
import * as libraryController from '../controllers/library.controller.js';
import { checkBook, checkIsbn } from '../middlewares/validate.middleware.js';

const router = Router();

router.post('/books', checkBook, libraryController.addBook);
router.get('/books/:isbn', [checkIsbn], libraryController.getBook);
router.route('/readers/:id').get(libraryController.getReader).delete(libraryController.removeReader);

export default router;
