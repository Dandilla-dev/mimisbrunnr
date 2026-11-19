import Book from './book.model.js';
import Reader from './reader.model.js';

// у книги много читателей, у читателя много книг — через таблицу loans
Book.belongsToMany(Reader, { through: 'loans', foreignKey: 'isbn', as: 'readers' });
Reader.belongsToMany(Book, { through: 'loans', foreignKey: 'reader_id', as: 'books' });

export { Book, Reader };
