# Crea un token de API para el usuario «admin» del OpenProject de prueba y lo imprime.
# Se corre con: bundle exec rails runner - < scripts/token-admin.rb
# La línea que importa es «TOKEN_ADMIN=<valor>»; el resto de la salida es ruido de Rails.
usuario = User.find_by!(login: 'admin')
token = Token::API.create!(user: usuario)
puts "TOKEN_ADMIN=#{token.plain_value}"
